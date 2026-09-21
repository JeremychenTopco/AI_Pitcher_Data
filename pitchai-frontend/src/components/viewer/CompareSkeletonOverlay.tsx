import { useCallback, useRef, useState } from "react";
import { useDualPlayback } from "@/playback/PlaybackContext";
import type { PoseData } from "@/api/dataSource";
import { INITIAL_CAMERA, Skeleton2DAt, projectPose, cameraYaw, type Camera } from "./PitchViewer";
import type { CameraAngle } from "./ViewSettings";

const COLOR_A = "#4a9eff";
const COLOR_B = "#ff9d3d";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Both records' skeletons on one stage — 骨架疊圖. Each side reads its own clock
 * (so the two poses stay at their own frames), and in 3D they share one camera
 * so the shapes can be compared directly. In video mode the background is
 * 記錄1's clip (it drives the shared clock via `registerVideo`, same as a plain
 * viewer) with both 2D skeletons drawn over it.
 */
export function CompareSkeletonOverlay({
  poseA,
  poseB,
  mode,
  camera = "1",
  videoUrl,
  className = "",
}: {
  poseA: PoseData | null;
  poseB: PoseData | null;
  mode: "video" | "pose2d" | "pose3d";
  /**
   * 機位, "pose2d" only — same 8-angle-around-360° reprojection as the
   * standalone 2D 骨架 stage (PitchViewer's Skeleton2D). "video" keeps both
   * skeletons on the clip's own real `joints2d` instead, same reasoning as
   * there: it has to line up with whatever video is underneath it.
   */
  camera?: CameraAngle;
  /** 記錄1's clip — only used when `mode` is "video". */
  videoUrl?: string | null;
  className?: string;
}) {
  const { a, b } = useDualPlayback();
  const [cam, setCam] = useState<Camera>(INITIAL_CAMERA);
  const [videoFailed, setVideoFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; button: number } | null>(null);

  const frameJoints = <K extends "joints2d" | "joints3d">(pose: PoseData | null, frame: number, key: K) =>
    pose?.frames[Math.min(frame, pose.frames.length - 1)]?.[key];

  const fromCamera = (joints3d: Array<[number, number, number]> | undefined) =>
    joints3d &&
    projectPose(joints3d, { ...INITIAL_CAMERA, yaw: cameraYaw(camera) }).map(
      (p): [number, number] => [p.x / 100, p.y / 100],
    );

  const jointsA = mode === "pose2d" ? fromCamera(frameJoints(poseA, a.frame, "joints3d")) : frameJoints(poseA, a.frame, "joints2d");
  const jointsB = mode === "pose2d" ? fromCamera(frameJoints(poseB, b.frame, "joints3d")) : frameJoints(poseB, b.frame, "joints2d");

  const skeletons2d = (
    <>
      {poseA && jointsA && (
        <div className="absolute inset-0">
          <Skeleton2DAt pose={poseA} joints={jointsA} stroke={COLOR_A} />
        </div>
      )}
      {poseB && jointsB && (
        <div className="absolute inset-0">
          <Skeleton2DAt pose={poseB} joints={jointsB} stroke={COLOR_B} dashed hollowJoints />
        </div>
      )}
    </>
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    drag.current = { x: e.clientX, y: e.clientY, button: e.button };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    drag.current = { ...d, x: e.clientX, y: e.clientY };
    setCam((c) =>
      d.button === 2
        ? { ...c, panX: c.panX + dx * 0.15, panY: c.panY + dy * 0.15 }
        : { ...c, yaw: c.yaw + dx * 0.01, pitch: clamp(c.pitch + dy * 0.01, -1.2, 1.2) },
    );
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  const ready = poseA && poseB;

  return (
    <div className={`relative overflow-hidden bg-black ${className}`}>
      {mode === "video" ? (
        <>
          {videoUrl && !videoFailed ? (
            <video
              ref={a.registerVideo}
              src={videoUrl}
              muted
              playsInline
              preload="auto"
              onError={() => setVideoFailed(true)}
              className="size-full object-contain"
            />
          ) : (
            <div className="grid size-full place-items-center text-sm text-neutral-400">
              {videoUrl ? "影片載入失敗" : "此球尚未上傳影片"}
            </div>
          )}
          {skeletons2d}
        </>
      ) : mode === "pose2d" ? (
        skeletons2d
      ) : (
        <svg
          viewBox="0 0 100 100"
          className="size-full cursor-grab touch-none active:cursor-grabbing"
          role="img"
          aria-label="3D 骨架疊圖：左鍵轉動視角，右鍵拖動，滾輪縮放"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onContextMenu={(e) => e.preventDefault()}
          onWheel={(e) => setCam((c) => ({ ...c, zoom: clamp(c.zoom * (1 - e.deltaY * 0.001), 0.4, 4) }))}
        >
          {poseA && frameJoints(poseA, a.frame, "joints3d") && (
            <Bones3D pose={poseA} points={projectPose(frameJoints(poseA, a.frame, "joints3d")!, cam)} color={COLOR_A} />
          )}
          {poseB && frameJoints(poseB, b.frame, "joints3d") && (
            <Bones3D pose={poseB} points={projectPose(frameJoints(poseB, b.frame, "joints3d")!, cam)} color={COLOR_B} dashed hollow />
          )}
        </svg>
      )}

      <div className="pointer-events-none absolute top-2 left-2 flex gap-3 rounded bg-black/55 px-2 py-1 text-[11px] font-bold text-white">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ background: COLOR_A }} /> 記錄1
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ background: COLOR_B }} /> 記錄2
        </span>
      </div>

      {mode === "pose3d" && (
        <button
          type="button"
          onClick={() => setCam(INITIAL_CAMERA)}
          className="absolute right-2 bottom-2 rounded bg-neutral-200/90 px-2 py-1 text-[11px] font-bold"
        >
          重設視角
        </button>
      )}

      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-sm text-neutral-500">載入骨架…</div>
      )}
    </div>
  );
}

function Bones3D({
  pose,
  points,
  color,
  dashed = false,
  hollow = false,
}: {
  pose: PoseData;
  points: Array<{ x: number; y: number; depth: number }>;
  color: string;
  dashed?: boolean;
  hollow?: boolean;
}) {
  return (
    <>
      {pose.bones.map(([a, b], i) => (
        <line
          key={i}
          x1={points[a].x}
          y1={points[a].y}
          x2={points[b].x}
          y2={points[b].y}
          stroke={color}
          strokeWidth={dashed ? 0.9 : 1}
          strokeLinecap="round"
          strokeDasharray={dashed ? "2.2 1.6" : undefined}
          opacity={0.5 + 0.45 * (1 - Math.min(1, Math.abs(points[a].depth) / 2))}
        />
      ))}
      {points.map((p, i) =>
        hollow ? (
          <circle key={i} cx={p.x} cy={p.y} r={1.1} fill="none" stroke={color} strokeWidth={0.7} />
        ) : (
          <circle key={i} cx={p.x} cy={p.y} r={1} fill={color} />
        ),
      )}
    </>
  );
}
