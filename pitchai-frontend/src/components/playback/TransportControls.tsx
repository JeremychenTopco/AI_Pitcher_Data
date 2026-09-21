import { SPEED_OPTIONS, usePlayback } from "@/playback/PlaybackContext";

/** Skip-to-start, step back, play/pause, step forward, skip-to-end, loop, speed. */
export function TransportControls() {
  const { playing, toggle, step, seek, frameCount, rate, setRate, loop, toggleLoop } = usePlayback();

  const btn = "grid size-9 place-items-center rounded hover:bg-neutral-100";

  return (
    <div className="flex items-center justify-center gap-6 bg-[var(--color-surface)] py-2">
      <button type="button" className={btn} onClick={() => seek(0)} aria-label="回到開頭">
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-4"><path d="M6 5h2v14H6zm12 0v14l-9-7z" /></svg>
      </button>
      <button type="button" className={btn} onClick={() => step(-1)} aria-label="上一格">
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-4"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" /></svg>
      </button>
      <button
        type="button"
        className="grid size-11 place-items-center rounded hover:bg-neutral-100"
        onClick={toggle}
        aria-label={playing ? "暫停" : "播放"}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-6"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-6"><path d="M7 4l14 8-14 8z" /></svg>
        )}
      </button>
      <button type="button" className={btn} onClick={() => step(1)} aria-label="下一格">
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-4"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6z" /></svg>
      </button>
      <button type="button" className={btn} onClick={() => seek(frameCount - 1)} aria-label="跳到結尾">
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-4"><path d="M16 5h2v14h-2zM6 5l9 7-9 7z" /></svg>
      </button>
      <button
        type="button"
        onClick={toggleLoop}
        aria-pressed={loop}
        aria-label="無限循環播放"
        title="無限循環播放"
        className={`grid size-9 place-items-center rounded ${loop ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
          <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
        </svg>
      </button>

      <div className="ml-2 flex gap-1 rounded bg-neutral-100 p-1">
        {SPEED_OPTIONS.map((o) => (
          <button
            key={o.rate}
            type="button"
            onClick={() => setRate(o.rate)}
            aria-pressed={rate === o.rate}
            className={`rounded px-2 py-1 text-xs font-medium ${
              rate === o.rate ? "bg-neutral-900 text-white" : "text-neutral-600"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
