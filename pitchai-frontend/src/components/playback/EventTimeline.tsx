import { useCallback, useEffect, useRef } from "react";
import { usePlayback } from "@/playback/PlaybackContext";
import { EVENT_LABELS, EVENT_NAMES, type EventKey, type PitchEvents } from "@/api/types";

const MARKED: EventKey[] = ["fp", "mer", "br"];

interface Props {
  /**
   * On the compare page, dragging either side's timeline should move both
   * clocks together (each keeping its own frame count, so a click at 60%
   * lands both at their own 60% mark) rather than only the scope it's drawn
   * in. Pass the dual-clock actions here to sync; omit for a single-clock
   * screen (report), where this scope's own clock is all there is.
   */
  sync?: {
    pause: () => void;
    seekRatio: (ratio: number) => void;
    jumpTo: (event: EventKey) => void;
  };
}

/**
 * Scrubber with the pitch's key events pinned along it. Click or drag anywhere
 * on the track to seek — the drag is tracked on `window` so it keeps working
 * even if the cursor leaves the track. The tick labels are buttons so keyboard
 * users can jump between events.
 */
export function EventTimeline({ sync }: Props = {}) {
  const { frame, frameCount, events, progress, seekRatio, jumpTo, pause } = usePlayback();
  const doPause = sync?.pause ?? pause;
  const doSeekRatio = sync?.seekRatio ?? seekRatio;
  const doJumpTo = sync?.jumpTo ?? jumpTo;
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const { left, width } = el.getBoundingClientRect();
      doSeekRatio(Math.max(0, Math.min(1, (clientX - left) / width)));
    },
    [doSeekRatio],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (dragging.current) {
        e.preventDefault();
        seekFromPointer(e.clientX);
      }
    };
    const end = () => {
      dragging.current = false;
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [seekFromPointer]);

  return (
    <div className="bg-[var(--color-surface)] px-4 pt-3 pb-1">
      <div
        ref={trackRef}
        className="relative h-4 cursor-pointer touch-none border-y-2 border-black select-none"
        role="slider"
        tabIndex={0}
        aria-label="播放進度"
        aria-valuemin={0}
        aria-valuemax={frameCount - 1}
        aria-valuenow={frame}
        onPointerDown={(e) => {
          e.preventDefault();
          dragging.current = true;
          doPause();
          seekFromPointer(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") doSeekRatio(Math.max(0, progress - 0.01));
          if (e.key === "ArrowRight") doSeekRatio(Math.min(1, progress + 0.01));
        }}
      >
        {/* Played portion, behind the event ticks and playhead. */}
        <span
          className="absolute inset-y-0 left-0 bg-[var(--color-progress-fill)]"
          style={{ width: `${progress * 100}%` }}
        />

        {MARKED.map((key) => {
          const at = events[key as keyof PitchEvents];
          if (at === undefined) return null;
          return (
            <span
              key={key}
              className="absolute top-0 h-full w-px bg-black"
              style={{ left: `${(at / (frameCount - 1)) * 100}%` }}
            />
          );
        })}

        <span
          className="absolute -top-0.5 h-[calc(100%+4px)] w-0.5 bg-[var(--color-event-fps)]"
          style={{ left: `${progress * 100}%` }}
        />
      </div>

      <div className="relative h-6">
        {MARKED.map((key) => {
          const at = events[key as keyof PitchEvents];
          if (at === undefined) return null;
          return (
            <button
              key={key}
              type="button"
              onClick={() => doJumpTo(key)}
              title={EVENT_NAMES[key]}
              className="absolute top-1 -translate-x-1/2 rounded bg-neutral-300 px-1.5 py-0.5 text-[10px] font-bold hover:bg-neutral-400"
              style={{ left: `${(at / (frameCount - 1)) * 100}%` }}
            >
              {EVENT_LABELS[key]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
