import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { VIEWER_MODES, type ViewerMode } from "./PitchViewer";

/**
 * Which camera rig the clip is shown from — 1–8, or "all" for every rig at
 * once. Real captures are single-camera today (every slot in a pitch's
 * `media.videoUrls` points at the same clip) until multi-rig footage exists.
 */
export type CameraAngle = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "all";

export const CAMERA_ANGLES: Array<{ id: CameraAngle; label: string }> = [
  { id: "1", label: "1" },
  { id: "2", label: "2" },
  { id: "3", label: "3" },
  { id: "4", label: "4" },
  { id: "5", label: "5" },
  { id: "6", label: "6" },
  { id: "7", label: "7" },
  { id: "8", label: "8" },
  { id: "all", label: "All" },
];

/** Short labels for the skeleton switch, matching Frame 194. */
const MODE_LABELS: Record<ViewerMode, string> = {
  video: "Video",
  pose3d: "3D",
  pose2d: "2D",
};

interface Props {
  mode: ViewerMode;
  onModeChange: (m: ViewerMode) => void;
  camera: CameraAngle;
  onCameraChange: (c: CameraAngle) => void;
  /** 投球比較 — on means the compare view, off means the plain data view. */
  compareOn: boolean;
  onCompareToggle: (on: boolean) => void;
  /** 骨架疊圖 — compare screen only; works in video, 2D and 3D alike. */
  skeletonOverlay?: boolean;
  onSkeletonOverlayToggle?: (on: boolean) => void;
  /** 疊骨架 — draw the 2D skeleton over the video (report screen, video mode). */
  poseOnVideo?: boolean;
  onPoseOnVideoToggle?: (on: boolean) => void;
  /** 疊人體模型 — 2D/3D 骨架 only; retargets a test skinned model onto this pitch's own joints. */
  showModel3D?: boolean;
  onShowModel3DToggle?: (on: boolean) => void;
}

/**
 * The 機位 / 骨架切換 / 投球比較 panel (Frame 194), opened from a chevron button
 * that sits in a screen's top-right. Closes on outside click or Escape.
 */
export function ViewSettings({
  mode,
  onModeChange,
  camera,
  onCameraChange,
  compareOn,
  onCompareToggle,
  skeletonOverlay,
  onSkeletonOverlayToggle,
  poseOnVideo,
  onPoseOnVideoToggle,
  showModel3D,
  onShowModel3DToggle,
}: Props) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  // 2D 骨架 shows one fixed-angle view at a time (see PitchViewer's
  // Skeleton2D) — no 8-up grid to show "all" of, unlike 影片.
  const cameraOptions =
    mode === "pose2d"
      ? CAMERA_ANGLES.map((o) => (o.id === "all" ? { ...o, disabled: true, title: "2D 骨架不支援同時顯示全部機位" } : o))
      : CAMERA_ANGLES;

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const reflow = () => place();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", reflow, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", reflow, true);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="檢視設定"
        className={`grid size-8 place-items-center rounded-md bg-white text-black shadow-md ring-1 ring-black/10 hover:bg-neutral-50 ${
          open ? "bg-neutral-100" : ""
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
          <path d="M4 6h11M4 12h7M4 18h13" />
          <circle cx="18" cy="6" r="2" fill="currentColor" />
          <circle cx="14" cy="12" r="2" fill="currentColor" />
          <circle cx="20" cy="18" r="2" fill="currentColor" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={panel}
            style={{ position: "fixed", top: pos.top, right: pos.right }}
            className="z-50 max-h-[80vh] w-72 overflow-y-auto rounded-lg bg-[var(--color-canvas)] p-5 shadow-xl ring-1 ring-black/10"
          >
          {mode !== "pose3d" && (
            <Section title="機位">
              <Segmented
                options={cameraOptions}
                value={camera}
                onChange={(v) => onCameraChange(v as CameraAngle)}
                columns={3}
              />
            </Section>
          )}

          <Section title="骨架切換">
            <Segmented
              options={VIEWER_MODES.map((m) => ({ id: m.id, label: MODE_LABELS[m.id] }))}
              value={mode}
              onChange={(v) => onModeChange(v as ViewerMode)}
            />

            {onPoseOnVideoToggle && mode === "video" && (
              <label className="mt-3 flex items-center justify-between">
                <span className="text-sm font-bold">疊骨架</span>
                <Toggle checked={Boolean(poseOnVideo)} onChange={onPoseOnVideoToggle} />
              </label>
            )}

            {onShowModel3DToggle && (mode === "pose2d" || mode === "pose3d") && (
              <label className="mt-3 flex items-center justify-between" title="測試用的預設人體模型，依此球的關節資料概略擬合姿態，非精確重建。">
                <span className="text-sm font-bold">疊人體模型</span>
                <Toggle checked={Boolean(showModel3D)} onChange={onShowModel3DToggle} />
              </label>
            )}
          </Section>

          <Section title="比較">
            <label className="flex items-center justify-between">
              <span className="text-sm font-bold">投球比較</span>
              <Toggle checked={compareOn} onChange={onCompareToggle} />
            </label>

            {onSkeletonOverlayToggle && (
              <label className="mt-3 flex items-center justify-between">
                <span className="text-sm font-bold">骨架疊圖</span>
                <Toggle checked={Boolean(skeletonOverlay)} onChange={onSkeletonOverlayToggle} />
              </label>
            )}
          </Section>
          </div>,
          document.body,
        )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-2 text-sm font-bold">{title}</p>
      {children}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
  columns,
}: {
  options: Array<{ id: string; label: string; disabled?: boolean; title?: string }>;
  value: string;
  onChange: (v: string) => void;
  /** Override the default one-row layout — needed once there are too many options for one row (機位: 1–8 + All). */
  columns?: number;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={o.disabled}
          title={o.disabled ? (o.title ?? "尚未開放") : o.title}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`rounded-lg px-1 py-3 text-sm font-bold ${
            o.disabled
              ? "cursor-not-allowed bg-white text-neutral-300"
              : value === o.id
                ? "bg-black text-white"
                : "bg-white text-neutral-800 hover:bg-neutral-100"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors ${
        checked ? "bg-[var(--color-status-done)]" : "bg-neutral-300"
      }`}
    >
      <span
        className={`size-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
