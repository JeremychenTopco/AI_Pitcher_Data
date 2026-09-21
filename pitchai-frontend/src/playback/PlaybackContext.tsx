import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { EventKey, PitchEvents } from "@/api/types";

/**
 * Every visual of a pitch — the video, the 2D/3D skeleton, its charts and its
 * scrubber — reads its position from one clock. Nothing keeps its own time, so
 * nothing can drift.
 *
 * Two drive modes, chosen automatically by whether a <video> is mounted:
 *   - No video (skeleton-only modes): a requestAnimationFrame loop steps
 *     `frame` at the pitch's analysis fps — there's nothing else to stay in
 *     sync with.
 *   - A video is registered: the *video* plays natively (its own decode
 *     pipeline, real frame pacing) and each rAF tick just reads its
 *     `currentTime` back into `frame`. Earlier this drove the video by
 *     force-seeking `currentTime` on every tick instead of letting it play,
 *     which stutters badly — seeking re-decodes from the nearest keyframe
 *     every time, so it can't run at the video's native rate. Seeking is now
 *     only used for deliberate jumps (scrub, step, jump-to-event).
 *
 * The compare page needs two independent clocks on screen at once, so the
 * clock itself is a hook. `PlaybackProvider` wraps one; `DualPlaybackProvider`
 * plus `PlaybackScope` wrap two and let each subtree pick which one it reads.
 * Consumers only ever call `usePlayback()` and never know which case they're in.
 */
export interface PlaybackState {
  frame: number;
  frameCount: number;
  fps: number;
  events: PitchEvents;
  playing: boolean;
  progress: number;
  /** Playback speed multiplier. 1 = 正常 (the fixture's own pace); &lt;1 slows it down. */
  rate: number;
  setRate: (rate: number) => void;
  /** Loop back to frame 0 and keep playing instead of stopping at the end. */
  loop: boolean;
  toggleLoop: () => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (frame: number) => void;
  seekRatio: (ratio: number) => void;
  step: (delta: number) => void;
  jumpTo: (event: EventKey) => void;
  registerVideo: (el: HTMLVideoElement | null) => void;
}

export interface ClockSpec {
  frameCount: number;
  fps: number;
  events: PitchEvents;
}

/**
 * Speed choices offered by the transport controls, as a multiplier on the
 * fixture's own base pace (120 frames at its declared fps, or — for a native
 * <video> — the file's own encoded speed). Rate 1 is that raw pace as
 * recorded, unmodified — the default. Labelled as plain multipliers (x4…1/4)
 * rather than 正常/慢速/etc. so the exact factor is always legible at a glance.
 */
export const SPEED_OPTIONS: Array<{ label: string; rate: number }> = [
  { label: "x4", rate: 4 },
  { label: "x2", rate: 2 },
  { label: "1", rate: 1 },
  { label: "1/2", rate: 0.5 },
  { label: "1/4", rate: 0.25 },
];

/** What a clock plays at until the viewer changes it — matches "1" above. */
const DEFAULT_RATE = 1;

function useClock({ frameCount, fps, events }: ClockSpec): PlaybackState {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [loop, setLoop] = useState(false);
  const toggleLoop = useCallback(() => setLoop((v) => !v), []);
  // State (not a plain ref) so the play effect re-runs when a video mounts or
  // unmounts — e.g. switching 骨架切換 in or out of 影片 mode mid-session.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const rafId = useRef<number | null>(null);

  const clamp = useCallback(
    (n: number) => Math.max(0, Math.min(frameCount - 1, Math.round(n))),
    [frameCount],
  );

  /** A deliberate jump (scrub, step, jump-to-event) — not the per-tick drive. */
  const seekVideo = useCallback(
    (f: number) => {
      if (!video) return;
      const t = f / fps;
      if (Math.abs(video.currentTime - t) > 1 / fps) video.currentTime = t;
    },
    [video, fps],
  );

  const seek = useCallback(
    (f: number) => {
      const next = clamp(f);
      setFrame(next);
      seekVideo(next);
    },
    [clamp, seekVideo],
  );

  const seekRatio = useCallback((ratio: number) => seek(ratio * (frameCount - 1)), [seek, frameCount]);

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      setFrame((f) => {
        const next = clamp(f + delta);
        seekVideo(next);
        return next;
      });
    },
    [clamp, seekVideo],
  );

  const jumpTo = useCallback(
    (event: EventKey) => {
      const target = events[event as keyof PitchEvents];
      if (target !== undefined) {
        setPlaying(false);
        seek(target);
      }
    },
    [events, seek],
  );

  const play = useCallback(() => {
    setFrame((f) => (f >= frameCount - 1 ? 0 : f));
    setPlaying(true);
  }, [frameCount]);

  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  useEffect(() => {
    if (!playing) {
      video?.pause();
      return;
    }

    if (video) {
      // Native playback: let the browser pace it, just read the time back.
      video.playbackRate = rate;
      seekVideo(frame >= frameCount - 1 ? 0 : frame);
      video.play().catch(() => {
        /* autoplay can be blocked before the first user gesture; the ▶ click that
           got us here counts, but ignore the rare race rather than throw. */
      });

      const tick = () => {
        const next = clamp(video.currentTime * fps);
        setFrame(next);
        if (video.ended || next >= frameCount - 1) {
          if (loop) {
            seekVideo(0);
            setFrame(0);
            video.play().catch(() => {});
          } else {
            setPlaying(false);
            return;
          }
        }
        rafId.current = requestAnimationFrame(tick);
      };
      rafId.current = requestAnimationFrame(tick);
      return () => {
        if (rafId.current !== null) cancelAnimationFrame(rafId.current);
        video.pause();
      };
    }

    // No video mounted (2D/3D skeleton only) — synthetic, time-based stepping.
    let last = performance.now();
    let acc = 0;
    const frameMs = 1000 / (fps * rate);

    const tick = (now: number) => {
      acc += now - last;
      last = now;
      if (acc >= frameMs) {
        const advance = Math.floor(acc / frameMs);
        acc -= advance * frameMs;
        setFrame((f) => {
          const next = f + advance;
          if (next >= frameCount - 1) {
            if (loop) return 0;
            setPlaying(false);
            return frameCount - 1;
          }
          return next;
        });
      }
      rafId.current = requestAnimationFrame(tick);
    };

    rafId.current = requestAnimationFrame(tick);
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `frame` deliberately excluded: only the *start* of a play run should seek.
  }, [playing, fps, frameCount, video, clamp, seekVideo, rate, loop]);

  const registerVideo = useCallback((el: HTMLVideoElement | null) => setVideo(el), []);

  return useMemo(
    () => ({
      frame,
      frameCount,
      fps,
      events,
      playing,
      progress: frameCount > 1 ? frame / (frameCount - 1) : 0,
      rate,
      setRate,
      loop,
      toggleLoop,
      play,
      pause,
      toggle,
      seek,
      seekRatio,
      step,
      jumpTo,
      registerVideo,
    }),
    [
      frame,
      frameCount,
      fps,
      events,
      playing,
      rate,
      loop,
      toggleLoop,
      play,
      pause,
      toggle,
      seek,
      seekRatio,
      step,
      jumpTo,
      registerVideo,
    ],
  );
}

const PlaybackContext = createContext<PlaybackState | null>(null);

export function PlaybackProvider({ frameCount, fps, events, children }: ClockSpec & { children: ReactNode }) {
  const clock = useClock({ frameCount, fps, events });
  return <PlaybackContext.Provider value={clock}>{children}</PlaybackContext.Provider>;
}

export function usePlayback() {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error("usePlayback must be used inside a PlaybackProvider or PlaybackScope");
  return ctx;
}

/* ------------------------------------------------------------------ dual */

export type Slot = "a" | "b";

export interface DualPlayback {
  a: PlaybackState;
  b: PlaybackState;
  /** Run the same command against both clocks. */
  both: (fn: (clock: PlaybackState) => void) => void;
}

const DualContext = createContext<DualPlayback | null>(null);

/** Two clocks for the compare page. Clip lengths differ, so they stay separate. */
export function DualPlaybackProvider({
  a,
  b,
  children,
}: {
  a: ClockSpec;
  b: ClockSpec;
  children: ReactNode;
}) {
  const clockA = useClock(a);
  const clockB = useClock(b);

  const value = useMemo<DualPlayback>(
    () => ({
      a: clockA,
      b: clockB,
      both: (fn) => {
        fn(clockA);
        fn(clockB);
      },
    }),
    [clockA, clockB],
  );

  return <DualContext.Provider value={value}>{children}</DualContext.Provider>;
}

export function useDualPlayback() {
  const ctx = useContext(DualContext);
  if (!ctx) throw new Error("useDualPlayback must be used inside a DualPlaybackProvider");
  return ctx;
}

/**
 * Picks which of the two clocks everything below reads. Wrap a side's viewer,
 * its timeline and its charts in the same scope and they stay in step.
 */
export function PlaybackScope({ slot, children }: { slot: Slot; children: ReactNode }) {
  const dual = useDualPlayback();
  return <PlaybackContext.Provider value={dual[slot]}>{children}</PlaybackContext.Provider>;
}
