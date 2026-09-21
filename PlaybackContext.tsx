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
 * The clock runs on requestAnimationFrame rather than the <video> element,
 * because the skeleton modes have no video to drive them. A mounted <video>
 * registers itself and gets seeked to match.
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

function useClock({ frameCount, fps, events }: ClockSpec): PlaybackState {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const videos = useRef<Set<HTMLVideoElement>>(new Set());
  const rafId = useRef<number | null>(null);

  const clamp = useCallback(
    (n: number) => Math.max(0, Math.min(frameCount - 1, Math.round(n))),
    [frameCount],
  );

  const syncVideos = useCallback(
    (f: number) => {
      const t = f / fps;
      videos.current.forEach((v) => {
        if (Math.abs(v.currentTime - t) > 1 / fps) v.currentTime = t;
      });
    },
    [fps],
  );

  const seek = useCallback(
    (f: number) => {
      const next = clamp(f);
      setFrame(next);
      syncVideos(next);
    },
    [clamp, syncVideos],
  );

  const seekRatio = useCallback((ratio: number) => seek(ratio * (frameCount - 1)), [seek, frameCount]);

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      setFrame((f) => {
        const next = clamp(f + delta);
        syncVideos(next);
        return next;
      });
    },
    [clamp, syncVideos],
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
    if (!playing) return;
    let last = performance.now();
    let acc = 0;
    const frameMs = 1000 / fps;

    const tick = (now: number) => {
      acc += now - last;
      last = now;
      if (acc >= frameMs) {
        const advance = Math.floor(acc / frameMs);
        acc -= advance * frameMs;
        setFrame((f) => {
          const next = f + advance;
          if (next >= frameCount - 1) {
            setPlaying(false);
            syncVideos(frameCount - 1);
            return frameCount - 1;
          }
          syncVideos(next);
          return next;
        });
      }
      rafId.current = requestAnimationFrame(tick);
    };

    rafId.current = requestAnimationFrame(tick);
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, [playing, fps, frameCount, syncVideos]);

  const registerVideo = useCallback((el: HTMLVideoElement | null) => {
    if (el) videos.current.add(el);
  }, []);

  return useMemo(
    () => ({
      frame,
      frameCount,
      fps,
      events,
      playing,
      progress: frameCount > 1 ? frame / (frameCount - 1) : 0,
      play,
      pause,
      toggle,
      seek,
      seekRatio,
      step,
      jumpTo,
      registerVideo,
    }),
    [frame, frameCount, fps, events, playing, play, pause, toggle, seek, seekRatio, step, jumpTo, registerVideo],
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
