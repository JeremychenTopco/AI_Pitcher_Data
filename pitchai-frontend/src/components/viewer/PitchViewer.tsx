import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlayback } from "@/playback/PlaybackContext";
import type { PoseData } from "@/api/dataSource";
import type { ScalarData, SeriesData } from "@/api/types";
import type { CameraAngle } from "./ViewSettings";

// three.js alone is ~600KB minified — code-split so everyone else's bundle
// doesn't grow just because this test feature exists; it's only fetched the
// first time someone actually turns on 疊人體模型.
const Model3DStage = lazy(() => import("./Model3DStage").then((m) => ({ default: m.Model3DStage })));

export type ViewerMode = "video" | "pose2d" | "pose3d";

export const VIEWER_MODES: Array<{ id: ViewerMode; label: string }> = [
  { id: "video", label: "影片" },
  { id: "pose2d", label: "2D 骨架" },
  { id: "pose3d", label: "3D 骨架" },
];

interface Props {
  mode: ViewerMode;
  /** One clip per 機位 (index 0 = camera 1 … index 7 = camera 8). */
  videoUrls: Array<string | null>;
  /** Which camera(s) to show in video mode. Defaults to camera 1. */
  camera?: CameraAngle;
  /**
   * Whether `camera === "all"` renders the 8-up grid. The 選手報告 screen
   * wants it; 比較 just wants the 1–8/All buttons without an 8-way grid on
   * each side, so it passes false and "all" there falls back to camera 1.
   */
  allowGrid?: boolean;
  pose: PoseData | null;
  /** Overlay the 2D skeleton on top of the video. Single-camera view only — not drawn on the 8-up grid. */
  overlay?: boolean;
  className?: string;
  /** joint_angle scalars — hover (or tap) a joint, in any mode, to read its angle. */
  jointAngles?: ScalarData[];
  /**
   * Per-frame angle curves, for joints whose value moves during the pitch
   * rather than being one fixed number — knees especially, which only exist
   * as a curve, never a scalar. Preferred over `jointAngles` wherever a
   * matching curve exists, so the badge tracks the frame you're actually on.
   */
  series?: SeriesData[];
  /**
   * 疊人體模型 — pose2d/pose3d only. Retargets a test skinned model
   * (Model3DStage) onto this pitch's own joint positions, frame for frame —
   * not a separate mode, a layer on top of (2D) or in place of (3D) the
   * stick-figure skeleton these two already draw.
   */
  showModel3D?: boolean;
}

/**
 * One stage, three renderings of the same instant. All of them read `frame`
 * from PlaybackContext, so switching mode mid-playback keeps your position.
 *
 * pose2d/pose3d project the joint-center skeleton itself rather than pulling
 * in three.js for the base render — the scene is fifteen points and fourteen
 * lines, so a hand-rolled projection is smaller and quicker than a WebGL
 * scene graph. `showModel3D` is the exception: it retargets a real skinned
 * mesh (Model3DStage, three.js) onto this same joint data, since the
 * hand-rolled projector can't render a mesh. See Model3DStage's own comment
 * for how that retargeting works and its limits.
 */
export function PitchViewer({
  mode,
  videoUrls,
  camera = "1",
  allowGrid = true,
  pose,
  overlay = false,
  className = "",
  jointAngles,
  series,
  showModel3D = false,
}: Props) {
  if (mode === "video") {
    if (camera === "all" && allowGrid) {
      return <VideoGridStage videoUrls={videoUrls} className={className} />;
    }
    const camIndex = camera === "all" ? 0 : Number(camera) - 1;
    return (
      <VideoStage
        videoUrl={videoUrls[camIndex] ?? null}
        pose={overlay ? pose : null}
        jointAngles={overlay ? jointAngles : undefined}
        series={overlay ? series : undefined}
        className={className}
      />
    );
  }
  if (mode === "pose2d")
    return (
      <Pose2DStage
        pose={pose}
        camera={camera}
        jointAngles={jointAngles}
        series={series}
        showModel3D={showModel3D}
        className={className}
      />
    );
  return (
    <Pose3DStage
      pose={pose}
      jointAngles={jointAngles}
      series={series}
      showModel3D={showModel3D}
      className={className}
    />
  );
}

/* ------------------------------------------------------------------ video */

function VideoStage({
  videoUrl,
  pose,
  jointAngles,
  series,
  className,
}: {
  videoUrl: string | null;
  pose: PoseData | null;
  jointAngles?: ScalarData[];
  series?: SeriesData[];
  className: string;
}) {
  const { registerVideo } = usePlayback();
  const [failed, setFailed] = useState(false);

  if (!videoUrl || failed) {
    return (
      <Stage className={className}>
        <p className="text-sm text-neutral-400">
          {videoUrl ? "影片載入失敗" : "此球尚未上傳影片"}
        </p>
      </Stage>
    );
  }

  return (
    <Stage className={className}>
      <video
        ref={registerVideo}
        src={videoUrl}
        muted
        playsInline
        preload="auto"
        onError={() => setFailed(true)}
        className="size-full object-contain"
      />
      {pose && (
        // Not pointer-events-none when angles are hoverable — the joint hit
        // targets inside need real pointer events; the rest of the overlay
        // (bones, dots) stays passthrough via Skeleton2DAt's own handling.
        <div className={`absolute inset-0 ${jointAngles || series ? "" : "pointer-events-none"}`}>
          <Skeleton2D pose={pose} stroke="#22e06a" jointAngles={jointAngles} series={series} />
        </div>
      )}
    </Stage>
  );
}

/**
 * 機位「All」— all 8 rigs at once in a 4×2 grid. Camera 1's tile drives the
 * shared clock the normal way (`registerVideo`); the other 7 are followers —
 * not registered with the clock, just nudged back onto `frame` whenever it
 * drifts more than a couple frames, and played/paused alongside it. No pose
 * overlay here (8 tiny skeletons would be unreadable); switch to a single
 * camera for that.
 */
function VideoGridStage({
  videoUrls,
  className,
}: {
  videoUrls: Array<string | null>;
  className: string;
}) {
  const { registerVideo, frame, fps, playing } = usePlayback();
  const followerRefs = useRef<Array<HTMLVideoElement | null>>([]);

  useEffect(() => {
    const t = frame / fps;
    for (const el of followerRefs.current) {
      if (el && Math.abs(el.currentTime - t) > 2 / fps) el.currentTime = t;
    }
  }, [frame, fps]);

  useEffect(() => {
    for (const el of followerRefs.current) {
      if (!el) continue;
      if (playing) el.play().catch(() => {});
      else el.pause();
    }
  }, [playing]);

  return (
    <Stage className={className}>
      <div className="grid size-full grid-cols-4 grid-rows-2 gap-px bg-neutral-800">
        {videoUrls.slice(0, 8).map((url, i) => (
          <GridCell
            key={i}
            camNumber={i + 1}
            videoUrl={url}
            videoRef={i === 0 ? registerVideo : (el) => (followerRefs.current[i] = el)}
          />
        ))}
      </div>
    </Stage>
  );
}

function GridCell({
  camNumber,
  videoUrl,
  videoRef,
}: {
  camNumber: number;
  videoUrl: string | null;
  videoRef: (el: HTMLVideoElement | null) => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative overflow-hidden bg-black">
      {videoUrl && !failed ? (
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          preload="auto"
          onError={() => setFailed(true)}
          className="size-full object-contain"
        />
      ) : (
        <div className="grid size-full place-items-center text-xs text-neutral-500">
          {videoUrl ? "載入失敗" : "無影片"}
        </div>
      )}
      <span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
        {camNumber}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------- 2D */

function Pose2DStage({
  pose,
  camera = "1",
  jointAngles,
  series,
  showModel3D,
  className,
}: {
  pose: PoseData | null;
  camera?: CameraAngle;
  jointAngles?: ScalarData[];
  series?: SeriesData[];
  showModel3D?: boolean;
  className: string;
}) {
  if (!pose) return <Stage className={className}><Loading /></Stage>;
  return (
    <Stage className={className}>
      {showModel3D && (
        <div className="absolute inset-0">
          <Suspense fallback={null}>
            <Model3DStage pose={pose} locked className="size-full" />
          </Suspense>
        </div>
      )}
      <div className="absolute inset-0">
        <Skeleton2D pose={pose} stroke="#22e06a" camera={camera} jointAngles={jointAngles} series={series} />
      </div>
    </Stage>
  );
}

/**
 * 機位 1–8 for the 2D 骨架 stage: there's no real multi-rig 2D footage, so each
 * slot is a fixed viewpoint around the pitcher — 360° split into 8 (45° apart)
 * — reprojected from the same `joints3d` the 3D stage uses (`projectPose`),
 * at a fixed elevation/zoom so only the angle around the pitcher changes.
 * `camera` undefined (the video-overlay 疊骨架 call, below) keeps using the
 * clip's own real `joints2d` instead — that one has to stay locked to the
 * actual recording camera to line up with the video underneath it.
 */
const CAMERA_STEP = (2 * Math.PI) / 8;

/** Exported so 比較's 骨架疊圖 (CompareSkeletonOverlay) can reuse the same 8-angle scheme. */
export function cameraYaw(camera: CameraAngle): number {
  const n = camera === "all" ? 1 : Number(camera);
  return (n - 1) * CAMERA_STEP;
}

function Skeleton2D({
  pose,
  stroke,
  camera,
  jointAngles,
  series,
}: {
  pose: PoseData;
  stroke: string;
  /** Set only by the standalone 2D 骨架 stage — see comment above. */
  camera?: CameraAngle;
  jointAngles?: ScalarData[];
  series?: SeriesData[];
}) {
  const { frame } = usePlayback();
  const at = Math.min(frame, pose.frames.length - 1);
  const joints3d = pose.frames[at]?.joints3d;
  const joints =
    camera !== undefined
      ? joints3d &&
        projectPose(joints3d, { ...INITIAL_CAMERA, yaw: cameraYaw(camera) }).map(
          (p): [number, number] => [p.x / 100, p.y / 100],
        )
      : pose.frames[at]?.joints2d;
  if (!joints) return null;
  return (
    <Skeleton2DAt
      pose={pose}
      joints={joints}
      stroke={stroke}
      jointAngles={jointAngles}
      series={series}
      frame={frame}
    />
  );
}

/**
 * Which pose joint (by name, either naming convention the fixtures use) shows
 * which angle. Tried in order: a per-frame series curve first (several
 * candidate keys, since the two fixture families don't share series-key
 * names the way they share the `joint_angle` scalar group), then the
 * fixed `joint_angle` scalar as a fallback. Lead/rear knee only exist as a
 * series (OBP fixtures) — synthetic fixtures have one unsplit knee curve
 * with no side attached, so it's deliberately left off rather than guessing
 * which leg it is.
 */
const JOINT_ANGLE_KEYS: Record<string, string> = {
  relbow: "elbow_angle",
  rshoulder: "shoulder_angle",
  neck: "torso_angle",
  pelvis: "pelvis_angle",
};
const FRAME_ANGLE_SERIES_KEYS: Record<string, string[]> = {
  relbow: ["elbow_flexion"],
  rshoulder: ["shoulder_abduction", "shoulder_abd"],
  neck: ["twist_torso", "torso_rotation"],
  pelvis: ["twist_pelvis"],
  lknee: ["lead_knee_flexion"],
  rknee: ["rear_knee_flexion"],
};
/**
 * Short label shown in front of the angle badge — deliberately its own
 * terse set rather than reusing the scalar/series `label` fields, since
 * those range from terse ("骨盆") to a full phrase ("MER 時手肘屈曲")
 * depending on which fixture generated them.
 */
const JOINT_DISPLAY_NAME: Record<string, string> = {
  relbow: "手肘",
  rshoulder: "肩膀",
  neck: "軀幹",
  pelvis: "骨盆",
  lknee: "前腳膝",
  rknee: "後腳膝",
};
export const normalizeJoint = (name: string) => name.toLowerCase().replace(/_/g, "");
const displayNameForJoint = (pose: PoseData, i: number) => JOINT_DISPLAY_NAME[normalizeJoint(pose.jointNames[i])];

/** Resolves one joint index to its angle value, from a series curve or a fixed scalar. */
function angleForJoint(
  pose: PoseData,
  jointAngles: ScalarData[] | undefined,
  series: SeriesData[] | undefined,
  frame: number,
  i: number,
): number | null {
  const name = normalizeJoint(pose.jointNames[i]);

  if (series) {
    for (const key of FRAME_ANGLE_SERIES_KEYS[name] ?? []) {
      const value = series.find((s) => s.key === key)?.samples[frame];
      if (value !== null && value !== undefined) return value;
    }
  }
  if (jointAngles) {
    const key = JOINT_ANGLE_KEYS[name];
    const value = key ? jointAngles.find((s) => s.key === key)?.value : undefined;
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

/**
 * An invisible, larger hit target over a joint dot. Hover reveals its badge
 * for a mouse; touch has no hover, so a tap toggles it instead. Shared by the
 * 2D and 3D stages so both switch the same way.
 */
function JointHotspot({
  x,
  y,
  onEnter,
  onLeave,
  onPick,
}: {
  x: number;
  y: number;
  onEnter: () => void;
  onLeave: () => void;
  onPick: () => void;
}) {
  return (
    <circle
      cx={x}
      cy={y}
      r={3}
      fill="transparent"
      className="cursor-pointer"
      onPointerEnter={(e) => e.pointerType !== "touch" && onEnter()}
      onPointerLeave={(e) => e.pointerType !== "touch" && onLeave()}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPick();
      }}
    />
  );
}

/** Frame-resolved 2D skeleton — the caller supplies the joint set to draw. */
export function Skeleton2DAt({
  pose,
  joints,
  stroke,
  dashed = false,
  hollowJoints = false,
  jointAngles,
  series,
  frame = 0,
}: {
  pose: PoseData;
  joints: Array<[number, number]>;
  stroke: string;
  dashed?: boolean;
  hollowJoints?: boolean;
  /** Enables hover (or tap, on touch) to reveal an angle badge — one point at a time, like a photo annotation. */
  jointAngles?: ScalarData[];
  /** Per-frame angle curves — preferred over `jointAngles` where a matching one exists. */
  series?: SeriesData[];
  frame?: number;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const angleAt = (i: number) => angleForJoint(pose, jointAngles, series, frame, i);

  const badge = picked !== null ? angleAt(picked) : null;
  const badgeJoint = picked !== null ? joints[picked] : null;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      className="size-full"
      role="img"
      aria-label="2D 骨架"
      onPointerDown={() => setPicked(null)}
    >
      {pose.bones.map(([a, b], i) => (
        <line
          key={i}
          x1={joints[a][0] * 100}
          y1={joints[a][1] * 100}
          x2={joints[b][0] * 100}
          y2={joints[b][1] * 100}
          stroke={stroke}
          strokeWidth={dashed ? 0.8 : 0.9}
          strokeLinecap="round"
          strokeDasharray={dashed ? "2 1.4" : undefined}
        />
      ))}
      {joints.map(([x, y], i) => {
        const clickable = (jointAngles || series) && angleAt(i) !== null;
        const isPicked = picked === i;
        return (
          <g key={i}>
            {hollowJoints ? (
              <circle cx={x * 100} cy={y * 100} r={1} fill="none" stroke={stroke} strokeWidth={0.7} />
            ) : (
              <circle
                cx={x * 100}
                cy={y * 100}
                r={isPicked ? 1.4 : 0.9}
                fill={isPicked ? "#22d3c6" : stroke}
              />
            )}
            {clickable && (
              <JointHotspot
                x={x * 100}
                y={y * 100}
                onEnter={() => setPicked(i)}
                onLeave={() => setPicked((cur) => (cur === i ? null : cur))}
                onPick={() => setPicked((cur) => (cur === i ? null : i))}
              />
            )}
          </g>
        );
      })}

      {badge !== null && badgeJoint && (
        <AngleBadge
          x={badgeJoint[0] * 100}
          y={badgeJoint[1] * 100}
          value={badge}
          name={displayNameForJoint(pose, picked!)}
        />
      )}
    </svg>
  );
}

/** A single floating "關節 NN°" pill with a leader line to its joint — click one point at a time. */
function AngleBadge({ x, y, value, name }: { x: number; y: number; value: number; name?: string }) {
  const dir = x > 55 ? -1 : 1; // keep the pill inside the frame near the left/right edges
  const bx = x + dir * 13;
  const by = Math.max(8, y - 11);
  const label = name ? `${name} ${Math.round(value)}°` : `${Math.round(value)}°`;
  const w = 8 + label.length * 4.2;

  return (
    <g pointerEvents="none">
      <circle cx={x} cy={y} r={1.3} fill="none" stroke="#22d3c6" strokeWidth={0.6} />
      <line x1={x} y1={y} x2={bx} y2={by + 3.2} stroke="#22d3c6" strokeWidth={0.5} />
      <rect x={bx - w / 2} y={by - 4} width={w} height={8} rx={4} fill="#22d3c6" />
      <text x={bx} y={by + 1.4} textAnchor="middle" fontSize={5} fontWeight="bold" fill="#0a2e2b">
        {label}
      </text>
    </g>
  );
}

/* -------------------------------------------------------------------- 3D */

export type Camera = { yaw: number; pitch: number; zoom: number; panX: number; panY: number };

export const INITIAL_CAMERA: Camera = { yaw: 0.5, pitch: 0.15, zoom: 1, panX: 0, panY: 0 };

/** Orthographic-ish projection of a 3D joint set to the 0–100 viewBox. */
export function projectPose(joints: Array<[number, number, number]>, cam: Camera) {
  const { yaw, pitch, zoom, panX, panY } = cam;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return joints.map(([x, y, z]) => {
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const scale = (34 * zoom) / (1 + z2 * 0.12);
    return { x: 50 + x1 * scale + panX, y: 55 - y2 * scale + panY, depth: z2 };
  });
}

/**
 * Mouse bindings, as specified:
 *   left drag   → orbit
 *   right drag  → pan
 *   wheel       → zoom
 *
 * The context menu is suppressed on the canvas so right-drag is usable. Touch
 * devices have no right button, so one-finger drag orbits and pinch is left to
 * the browser; a modifier-free pan gesture can be added if tablets matter.
 */
function Pose3DStage({
  pose,
  jointAngles,
  series,
  showModel3D,
  className,
}: {
  pose: PoseData | null;
  jointAngles?: ScalarData[];
  series?: SeriesData[];
  showModel3D?: boolean;
  className: string;
}) {
  const { frame } = usePlayback();
  const [cam, setCam] = useState<Camera>(INITIAL_CAMERA);
  const [picked, setPicked] = useState<number | null>(null);
  const drag = useRef<{ x: number; y: number; button: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    setPicked(null);
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
        : {
            ...c,
            yaw: c.yaw + dx * 0.01,
            pitch: Math.max(-1.2, Math.min(1.2, c.pitch + dy * 0.01)),
          },
    );
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  const joints = pose?.frames[Math.min(frame, pose.frames.length - 1)]?.joints3d;

  const projected = useMemo(() => (joints ? projectPose(joints, cam) : null), [joints, cam]);

  if (showModel3D) {
    return (
      <Suspense fallback={<Stage className={className}><Loading /></Stage>}>
        <Model3DStage pose={pose} className={className} />
      </Suspense>
    );
  }

  return (
    <Stage className={className}>
      {!pose || !projected ? (
        <Loading />
      ) : (
        <>
          <svg
            viewBox="0 0 100 100"
            className="size-full cursor-grab touch-none active:cursor-grabbing"
            role="img"
            aria-label="3D 骨架：左鍵轉動視角，右鍵拖動，滾輪縮放"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onContextMenu={(e) => e.preventDefault()}
            onWheel={(e) =>
              setCam((c) => ({ ...c, zoom: Math.max(0.4, Math.min(4, c.zoom * (1 - e.deltaY * 0.001))) }))
            }
          >
            <GroundGrid cam={cam} />
            {pose.bones.map(([a, b], i) => (
              <line
                key={i}
                x1={projected[a].x}
                y1={projected[a].y}
                x2={projected[b].x}
                y2={projected[b].y}
                stroke="#22e06a"
                strokeWidth={1}
                strokeLinecap="round"
                opacity={0.55 + 0.45 * (1 - Math.min(1, Math.abs(projected[a].depth) / 2))}
              />
            ))}
            {projected.map((p, i) => {
              const isPicked = picked === i;
              const clickable =
                pose && (jointAngles || series) && angleForJoint(pose, jointAngles, series, frame, i) !== null;
              return (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={isPicked ? 1.6 : 1} fill={isPicked ? "#22d3c6" : "#22e06a"} />
                  {clickable && (
                    <JointHotspot
                      x={p.x}
                      y={p.y}
                      onEnter={() => setPicked(i)}
                      onLeave={() => setPicked((cur) => (cur === i ? null : cur))}
                      onPick={() => setPicked((cur) => (cur === i ? null : i))}
                    />
                  )}
                </g>
              );
            })}
            {picked !== null &&
              pose &&
              angleForJoint(pose, jointAngles, series, frame, picked) !== null && (
                <AngleBadge
                  x={projected[picked].x}
                  y={projected[picked].y}
                  value={angleForJoint(pose, jointAngles, series, frame, picked)!}
                  name={displayNameForJoint(pose, picked)}
                />
              )}
          </svg>

          <div className="absolute right-3 bottom-3 flex gap-3 rounded bg-neutral-200/90 px-3 py-1.5 text-[11px] font-medium">
            <span>左鍵 轉動視角</span>
            <span>右鍵 拖動</span>
            <span>滾輪 放大縮小</span>
            <button type="button" onClick={() => setCam(INITIAL_CAMERA)} className="font-bold underline">
              重設
            </button>
          </div>
        </>
      )}
    </Stage>
  );
}

function GroundGrid({ cam }: { cam: Camera }) {
  const lines = useMemo(() => {
    const { yaw, pitch, zoom, panX, panY } = cam;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const project = (x: number, z: number) => {
      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      const y2 = -z1 * sp;
      const z2 = z1 * cp;
      const scale = (34 * zoom) / (1 + z2 * 0.12);
      return { x: 50 + x1 * scale + panX, y: 55 - y2 * scale + panY };
    };
    const out: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (let i = -2; i <= 2; i++) {
      const a = project(i * 0.5, -1), b = project(i * 0.5, 1);
      const c = project(-1, i * 0.5), d = project(1, i * 0.5);
      out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      out.push({ x1: c.x, y1: c.y, x2: d.x, y2: d.y });
    }
    return out;
  }, [cam]);

  return (
    <g stroke="#2a2a2a" strokeWidth={0.3}>
      {lines.map((l, i) => (
        <line key={i} {...l} />
      ))}
    </g>
  );
}

/* ----------------------------------------------------------------- shared */

function Stage({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`relative overflow-hidden bg-black ${className}`}>{children}</div>;
}

function Loading() {
  return <div className="grid size-full place-items-center text-sm text-neutral-500">載入中…</div>;
}
