import type { ScalarData } from "@/api/types";
import { usePlayback } from "@/playback/PlaybackContext";

/**
 * The top-left readout over a viewer — Sequencing plus the joint angles. It is
 * clipped to the frame (`overflow-hidden` + frame-relative max size) so it can
 * never spill outside the video / 2D / 3D box, and passes pointer events
 * through so it does not block the 3D orbit or video.
 *
 * `floating=false` drops the absolute positioning and returns just the panel,
 * for a caller that places it itself — 機位「All」's 8-up grid needs this: a
 * top-left overlay would sit right on top of camera 1's tile, so 選手報告
 * lays it out as a left-hand sidebar instead of floating it (see ReportPage).
 */
export function ViewerHud({
  sequencing,
  joints,
  tint,
  floating = true,
}: {
  sequencing: ScalarData | null;
  joints: ScalarData[];
  tint?: string;
  floating?: boolean;
}) {
  if (!sequencing && joints.length === 0) return null;

  // Floating (over the video, little room): one line per entry, label
  // truncated so a long name can't push the box wider than the frame.
  // Sidebar (its own column, plenty of height): label allowed to wrap onto
  // its own line instead of being cut off — nothing to truncate against.
  const row = floating ? "flex justify-between gap-4" : "flex flex-col gap-0.5";
  const label = floating ? "truncate text-white/80" : "text-white/80";
  const value = floating ? "shrink-0 font-bold" : "font-bold";

  const panel = (
    <dl className="max-w-full rounded bg-black/45 px-2.5 py-1.5 text-[10px] leading-tight text-white backdrop-blur-sm">
      {sequencing && (
        <div className={`${row} border-b border-white/25 py-0.5 font-bold`} style={tint ? { color: tint } : undefined}>
          <dt>Sequencing</dt>
          <dd>{sequencing.value ?? "—"}%</dd>
        </div>
      )}
      {joints.map((s) => (
        <div key={s.key} className={`${row} py-0.5`}>
          <dt className={label}>{s.labelEn}</dt>
          <dd className={value}>{s.value}°</dd>
        </div>
      ))}
    </dl>
  );

  if (!floating) return panel;

  return (
    <div className="pointer-events-none absolute top-2 left-2 max-h-[calc(100%-1rem)] max-w-[calc(100%-1rem)] overflow-hidden">
      {panel}
    </div>
  );
}

/**
 * Bottom-left readout over a viewer — current frame, not just the clip's
 * static fps (which told you nothing about playback position).
 */
export function FrameReadout({ tint }: { tint?: string }) {
  const { frame, frameCount, fps } = usePlayback();
  return (
    <span
      className="pointer-events-none absolute bottom-2 left-2 rounded bg-neutral-200/90 px-1.5 py-0.5 text-[10px] font-bold"
      style={tint ? { color: tint } : undefined}
    >
      第 {frame + 1}/{frameCount} 禎 ・ {fps}fps
    </span>
  );
}
