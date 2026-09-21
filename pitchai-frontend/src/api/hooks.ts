import { useEffect, useState } from "react";
import { dataSource, type PoseData } from "./dataSource";
import type {
  HomeSummary,
  Pitch,
  PitchDetail,
  Role,
  ScalarData,
  ScalarGroupKey,
  SeriesData,
  SeriesGroupKey,
  Session,
  Team,
} from "./types";

/**
 * The roster is mutable on the client (see PlayersStore), so `usePlayers` /
 * `usePlayer` come from that context rather than a one-shot fetch. Re-exported
 * here so call sites keep importing hooks from one place.
 */
export { usePlayers, usePlayer } from "@/app/PlayersStore";

interface Async<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/** Minimal async wrapper. Swap for TanStack Query when caching gets real. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<Async<T>>({ data: null, loading: true, error: null });

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => live && setState({ data, loading: false, error: null }))
      .catch((error) => live && setState({ data: null, loading: false, error }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

export const useTeam = () => useAsync<Team>(() => dataSource.getTeam(), []);
export const useHome = (role: Role) => useAsync<HomeSummary>(() => dataSource.getHome(role), [role]);
export const useSessions = (playerId?: string) =>
  useAsync<Session[]>(() => dataSource.getSessions(playerId), [playerId]);
export const useSession = (id: string) => useAsync(() => dataSource.getSession(id), [id]);
export const usePitches = (sessionId: string) =>
  useAsync<Pitch[]>(() => dataSource.getPitches(sessionId), [sessionId]);
export const usePitch = (id: string) => useAsync<PitchDetail>(() => dataSource.getPitch(id), [id]);
export const usePose = (id: string) => useAsync<PoseData>(() => dataSource.getPose(id), [id]);

/* ------------------------------------------------------------- selectors */

export function scalarsIn(scalars: ScalarData[], group: ScalarGroupKey) {
  return scalars.filter((s) => s.group === group);
}

export function scalarByKey(scalars: ScalarData[], key: string) {
  return scalars.find((s) => s.key === key) ?? null;
}

export function seriesIn(series: SeriesData[], group: SeriesGroupKey) {
  return series.filter((s) => s.group === group);
}

/** Which series groups appear under each report tab. */
export const TAB_GROUPS: Record<string, SeriesGroupKey[]> = {
  summary: ["phase_sequencing"],
  arm: ["arm_angle", "arm_velocity"],
  trunk: [
    "trunk_flexion_angle",
    "trunk_twist_angle",
    "trunk_flexion_velocity",
    "trunk_twist_velocity",
  ],
  knee: ["knee_angle", "knee_velocity"],
};

export const GROUP_HEADINGS: Record<SeriesGroupKey, { zh: string; en: string }> = {
  phase_sequencing: { zh: "動作階段分序", en: "Phase Sequencing" },
  arm_angle: { zh: "手臂角度運動學分析", en: "Arm Angle Kinematics Analysis" },
  arm_velocity: { zh: "手臂角速度運動學分析", en: "Arm Angular Velocity Kinematics Analysis" },
  trunk_flexion_angle: { zh: "軀幹屈曲角度", en: "Trunk Flexion Angle" },
  trunk_twist_angle: { zh: "軀幹旋轉角度", en: "Trunk Twist Angle" },
  trunk_flexion_velocity: { zh: "軀幹屈曲角速度", en: "Trunk Flexion Velocity" },
  trunk_twist_velocity: { zh: "軀幹旋轉角速度", en: "Trunk Twist Velocity" },
  knee_angle: { zh: "膝關節屈曲", en: "Knee Flexion Angle" },
  knee_velocity: { zh: "膝關節伸展角速度", en: "Knee Extension Velocity" },
};

/** Where a scalar sits inside its reference range, clamped to 0–1. */
export function scalarPosition(s: ScalarData): number | null {
  if (s.value === null) return null;
  const span = s.refMax - s.refMin;
  if (span <= 0) return null;
  return Math.max(0, Math.min(1, (s.value - s.refMin) / span));
}
