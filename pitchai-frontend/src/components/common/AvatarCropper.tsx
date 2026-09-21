import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadImage } from "@/lib/image";

const BOX = 260; // crop viewport, px
const OUT = 256; // output size, px
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * A minimal square/circle image cropper. Drag to reposition, slider or wheel to
 * zoom; the image always covers the frame. `onDone` gets a 256×256 JPEG data URL.
 */
export function AvatarCropper({
  src,
  onDone,
  onCancel,
}: {
  src: string;
  onDone: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let live = true;
    loadImage(src).then((i) => {
      if (!live) return;
      setImg(i);
      const cover = BOX / Math.min(i.width, i.height);
      const dw = i.width * cover;
      const dh = i.height * cover;
      setZoom(1);
      setOff({ x: (BOX - dw) / 2, y: (BOX - dh) / 2 });
    });
    return () => {
      live = false;
    };
  }, [src]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  if (!img) return null;

  const cover = BOX / Math.min(img.width, img.height);
  const S = cover * zoom;
  const dw = img.width * S;
  const dh = img.height * S;
  const clampOff = (o: { x: number; y: number }) => ({
    x: clamp(o.x, BOX - dw, 0),
    y: clamp(o.y, BOX - dh, 0),
  });
  const pos = clampOff(off);

  const apply = () => {
    const c = document.createElement("canvas");
    c.width = OUT;
    c.height = OUT;
    const sx = -pos.x / S;
    const sy = -pos.y / S;
    const sSize = BOX / S;
    c.getContext("2d")?.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUT, OUT);
    onDone(c.toDataURL("image/jpeg", 0.85));
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-[300px] rounded-xl bg-white p-5 shadow-2xl">
        <p className="mb-3 text-sm font-bold">裁切頭像</p>

        <div
          className="relative mx-auto touch-none overflow-hidden rounded-lg bg-neutral-200 select-none"
          style={{ width: BOX, height: BOX }}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            drag.current = { x: e.clientX, y: e.clientY };
            setOff((o) => clampOff({ x: o.x + dx, y: o.y + dy }));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onWheel={(e) => setZoom((z) => clamp(z * (1 - e.deltaY * 0.0015), 1, 5))}
        >
          <img
            src={src}
            alt=""
            draggable={false}
            className="pointer-events-none max-w-none"
            style={{ width: dw, height: dh, transform: `translate(${pos.x}px, ${pos.y}px)` }}
          />
          {/* darken everything outside the circular crop area */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div
              className="rounded-full ring-2 ring-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
              style={{ width: BOX - 16, height: BOX - 16 }}
            />
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-xs text-neutral-500">
          縮放
          <input
            type="range"
            min={1}
            max={5}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1"
          />
        </label>

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={apply} className="flex-1 bg-black py-2 text-xs font-bold text-white">
            確定
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 bg-neutral-200 py-2 text-xs font-bold text-neutral-700"
          >
            取消
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
