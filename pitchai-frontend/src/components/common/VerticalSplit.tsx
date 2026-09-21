import { useRef, useState, type ReactNode } from "react";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * A draggable top/bottom split. `ratio` is the top pane's share of the height,
 * kept between `min` and `max` (default 20 % – 70 %). Both panes clip; each
 * child lays out its own scrolling. Remembered per `id`.
 */
export function VerticalSplit({
  id,
  top,
  bottom,
  initial = 0.5,
  min = 0.2,
  max = 0.7,
}: {
  id: string;
  top: ReactNode;
  bottom: ReactNode;
  initial?: number;
  min?: number;
  max?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const key = `pitchai.split.${id}`;

  const [ratio, setRatio] = useState(() => {
    try {
      const s = Number(localStorage.getItem(key));
      if (s >= min && s <= max) return s;
    } catch {
      /* ignore */
    }
    return clamp(initial, min, max);
  });

  const apply = (clientY: number) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r || r.height === 0) return;
    setRatio(clamp((clientY - r.top) / r.height, min, max));
  };

  return (
    <div ref={wrap} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-col overflow-hidden" style={{ flexGrow: ratio, flexBasis: 0 }}>
        {top}
      </div>

      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="調整檢視器高度"
        tabIndex={0}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => dragging.current && apply(e.clientY)}
        onPointerUp={(e) => {
          dragging.current = false;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          try {
            localStorage.setItem(key, String(ratio));
          } catch {
            /* ignore */
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") setRatio((v) => clamp(v - 0.03, min, max));
          if (e.key === "ArrowDown") setRatio((v) => clamp(v + 0.03, min, max));
        }}
        className="group relative z-20 flex h-2.5 shrink-0 cursor-row-resize touch-none items-center justify-center bg-neutral-100 hover:bg-neutral-200"
      >
        <span className="h-1 w-10 rounded-full bg-neutral-300 group-hover:bg-neutral-400" />
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden" style={{ flexGrow: 1 - ratio, flexBasis: 0 }}>
        {bottom}
      </div>
    </div>
  );
}
