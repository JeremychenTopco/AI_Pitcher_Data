/**
 * API contract. These types are the boundary with the backend — the JSON
 * fixtures under /public/api and the MySQL schema in /server/schema.sql both
 * conform to exactly these shapes, so swapping the fixture adapter for a real
 * HTTP adapter changes no component code.
 *
 * Measurements split into two families:
 *
 *   線性資料 SeriesData — one value per frame, drawn as a curve.
 *   單一值   ScalarData — one value per pitch, drawn as a metric card.
 */

/* ---------------------------------------------------------------- events */

export type EventKey = "fps" | "fp" | "mer" | "br";

/** Frame index of each key moment. FP / MER / BR anchor everything. */
export interface PitchEvents {
  fps?: number;
  /** Front foot plant. */
  fp: number;
  /** Maximum external rotation. */
  mer: number;
  /** Ball release. */
  br: number;
}

export const EVENT_LABELS: Record<EventKey, string> = {
  fps: "fps",
  fp: "FP",
  mer: "MER",
  br: "BR",
};

export const EVENT_NAMES: Record<EventKey, string> = {
  fps: "起始",
  fp: "前腳著地 Foot Plant",
  mer: "最大外旋 Max External Rotation",
  br: "球出手 Ball Release",
};

/* ---------------------------------------------------- 線性資料 (per frame) */

export type SeriesGroupKey =
  | "phase_sequencing"
  | "arm_angle"
  | "arm_velocity"
  | "trunk_flexion_angle"
  | "trunk_twist_angle"
  | "trunk_flexion_velocity"
  | "trunk_twist_velocity"
  | "knee_angle"
  | "knee_velocity";

export interface SeriesData {
  /** Stable key, matches pitch_series.series_key in MySQL. */
  key: string;
  group: SeriesGroupKey;
  label: string;
  labelEn: string;
  unit: "deg" | "deg/sec";
  color: string;
  /** One sample per frame. null marks a gap the pose pipeline could not solve. */
  samples: Array<number | null>;
  /** Normative range (參考帶) from the comparison cohort, same length as samples. */
  refLower: number[] | null;
  refUpper: number[] | null;
  /** Axis bounds. Fixed per series so charts stay comparable across pitches. */
  yMin: number;
  yMax: number;
}

/* ------------------------------------------------------ 單一值 (per pitch) */

export type ScalarGroupKey = "summary" | "joint_angle" | "release";

export interface ScalarData {
  /** Stable key, matches pitch_scalars.scalar_key in MySQL. */
  key: string;
  group: ScalarGroupKey;
  label: string;
  labelEn: string;
  unit: string;
  value: number | null;
  /** Reference range used to place the marker on the three-band bar. */
  refMin: number;
  refMax: number;
  /** Frame the value was sampled at, when it is tied to an event. */
  atEvent: EventKey | null;
  hint: string;
}

/* -------------------------------------------------------------- media */

export interface PoseFrame {
  /** [x, y] in 0–1 normalised image space, one entry per joint. */
  joints2d: Array<[number, number]>;
  /** [x, y, z] in metres, origin at the pitching rubber. */
  joints3d: Array<[number, number, number]>;
}

export interface PitchMedia {
  /**
   * One clip per 機位 (camera position), index 0 = camera 1 … index 7 =
   * camera 8. Always length 8; a slot is null where that camera has no
   * footage. Real captures today are single-camera, so every slot points at
   * the same clip until multi-rig footage exists.
   */
  videoUrls: Array<string | null>;
  /** Path to the pose payload; fetched separately because it is large. */
  poseUrl: string | null;
  width: number;
  height: number;
}

/* -------------------------------------------------------------- records */

export type AnalysisStatus = "pending" | "processing" | "done" | "failed";

export const STATUS_LABELS: Record<AnalysisStatus, string> = {
  pending: "待處理",
  processing: "運算中",
  done: "完成",
  failed: "失敗",
};

export interface Pitch {
  id: string;
  sessionId: string;
  number: number;
  pitchType: string;
  velocityKmh: number | null;
  status: AnalysisStatus;
  thrownAt: string;
  frameCount: number;
  fps: number;
  events: PitchEvents;
  starred: boolean;
}

export interface PitchDetail extends Pitch {
  media: PitchMedia;
  scalars: ScalarData[];
  series: SeriesData[];
}

export interface Session {
  id: string;
  playerId: string;
  playerName: string;
  date: string;
  label: string;
  status: AnalysisStatus;
  pitchCount: number;
}

export interface Player {
  id: string;
  teamId: string;
  name: string;
  avatarUrl: string | null;
  heightCm: number;
  weightKg: number;
  throws: "L" | "R";
  birthDate: string;
}

export type Role = "coach" | "player";

export interface User {
  id: string;
  role: Role;
  name: string;
  email: string;
  playerId: string | null;
  teamId: string;
  /** Data URL or path; null falls back to the placeholder icon. */
  avatarUrl?: string | null;
}

export interface Team {
  id: string;
  name: string;
}

/* -------------------------------------------------------- home summary */

export interface HomeSummary {
  processingCount: number;
  weekCount: number;
  pendingCount: number;
  recentSessions: Session[];
}
