import type {
  HomeSummary,
  Pitch,
  PitchDetail,
  Player,
  Role,
  Session,
  Team,
  User,
} from "./types";

export interface PoseData {
  jointNames: string[];
  bones: Array<[number, number]>;
  frames: Array<{
    joints2d: Array<[number, number]>;
    joints3d: Array<[number, number, number]>;
  }>;
}

/**
 * Everything the UI needs from the backend, in one interface.
 *
 * `fixtureSource` reads the generated JSON under /public/api.
 * `httpSource` hits the real API. Both satisfy this interface, so switching is
 * a one-line change in `dataSource` below and no component has to know.
 */
export interface DataSource {
  getTeam(): Promise<Team>;
  getUsers(): Promise<User[]>;
  getPlayers(): Promise<Player[]>;
  getPlayer(playerId: string): Promise<Player | undefined>;
  getHome(role: Role): Promise<HomeSummary>;
  getSessions(playerId?: string): Promise<Session[]>;
  getSession(sessionId: string): Promise<Session | undefined>;
  getPitches(sessionId: string): Promise<Pitch[]>;
  getPitch(pitchId: string): Promise<PitchDetail>;
  getPose(pitchId: string): Promise<PoseData>;
}

/**
 * Every OBP trial that has a real generated pitch/pose JSON (see
 * scripts/obp_to_fixture.mjs) — shared between getPitch's and getPose's
 * AVAILABLE lists so the two can't drift apart.
 */
const OBP_TRIALS = [
  "obp_1031_2",
  "obp_3053_1",
  "obp_1623_3",
  "obp_1668_1",
  "obp_2916_4",
  "obp_1717_1",
  "obp_2891_1",
  "obp_2891_2",
  "obp_2891_3",
  "obp_2891_4",
  "obp_2891_5",
  "obp_1718_1",
  "obp_1718_2",
  "obp_1718_3",
  "obp_1371_2",
  "obp_1371_3",
  "obp_2969_1",
  "obp_2969_2",
  "obp_2969_3",
  "obp_3037_1",
  "obp_3037_2",
  "obp_3037_3",
  "obp_3037_4",
  "obp_3037_5",
  "obp_3046_1",
  "obp_3046_2",
  "obp_3046_3",
  "obp_3046_4",
];

/* ---------------------------------------------------- mock record variation */

/** id → 0..1, stable per id (FNV-1a). */
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 2 ** 32;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Deterministically reshapes a fixture into a "different" record: shifts the
 * event phase, scales each curve about its midline and adds a small bias, and
 * nudges every scalar. Same id in → same result out, so charts stay stable.
 */
function varyPitch(detail: PitchDetail, id: string): PitchDetail {
  const seed = seedOf(id);
  const shift = Math.round((seed - 0.5) * 14); // frames
  const gain = 0.8 + seed * 0.45;
  const bias = (seed - 0.5) * 0.16;

  const move = (f: number) => clamp(f + shift, 0, detail.frameCount - 1);

  const warpSamples = (samples: Array<number | null>, yMin: number, yMax: number) => {
    const mid = (yMin + yMax) / 2;
    const span = yMax - yMin || 1;
    return samples.map((_, i) => {
      const src = samples[clamp(i - shift, 0, samples.length - 1)];
      if (src === null || src === undefined) return null;
      return clamp(mid + (src - mid) * gain + bias * span, yMin, yMax);
    });
  };

  return {
    ...detail,
    id,
    events: {
      ...detail.events,
      fps: detail.events.fps === undefined ? undefined : move(detail.events.fps),
      fp: move(detail.events.fp),
      mer: move(detail.events.mer),
      br: move(detail.events.br),
    },
    scalars: detail.scalars.map((s) =>
      s.value === null
        ? s
        : { ...s, value: Math.round(clamp(s.value * (0.82 + seed * 0.4), s.refMin * 0.4, s.refMax * 1.6)) },
    ),
    series: detail.series.map((s) => ({
      ...s,
      samples: warpSamples(s.samples, s.yMin, s.yMax),
    })),
  };
}

/**
 * Same idea for the skeleton: reindex the frames (different timing), then rotate
 * / scale / offset the joints so 記錄2's motion visibly differs from 記錄1's in
 * the 骨架疊圖 view. Deterministic per id.
 */
function varyPose(pose: PoseData, id: string): PoseData {
  const seed = seedOf(id);
  const seed2 = seedOf(id + "~");
  const n = pose.frames.length;
  const shift = Math.round((seed - 0.5) * 26); // bigger timing offset
  const ang = (seed - 0.5) * 1.1; // ~±32° tilt / yaw
  const lean = (seed2 - 0.5) * 0.7; // extra 3D pitch
  const scale = 0.82 + seed * 0.4;
  const dx = (seed - 0.5) * 0.18;
  const dy = (0.5 - seed2) * 0.14;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const cp = Math.cos(lean);
  const sp = Math.sin(lean);

  const rot2d = ([x, y]: [number, number]): [number, number] => {
    const px = (x - 0.5) * scale;
    const py = (y - 0.5) * scale;
    return [0.5 + (px * cos - py * sin) + dx, 0.5 + (px * sin + py * cos) + dy];
  };
  const rot3d = ([x, y, z]: [number, number, number]): [number, number, number] => {
    // yaw about vertical, then a pitch lean about X
    const rx = x * cos - z * sin;
    const rz = x * sin + z * cos;
    const ry = y * cp - rz * sp;
    return [rx * scale + dx, ry * scale + dy, (y * sp + rz * cp) * scale];
  };

  return {
    ...pose,
    frames: pose.frames.map((_, i) => {
      const src = pose.frames[clamp(i - shift, 0, n - 1)];
      return {
        joints2d: src.joints2d.map(rot2d),
        joints3d: src.joints3d.map(rot3d),
      };
    }),
  };
}

/**
 * No caching here on purpose. This used to cache indefinitely (once per tab
 * lifetime), which was fine while these files were truly static — but during
 * fixture development they get regenerated on disk repeatedly without a full
 * reload, and an indefinite cache means an already-open tab keeps serving
 * whatever it first fetched, forever. That silently produced several rounds
 * of "wrong name showing" reports that were actually just stale roster/
 * session snapshots, not real bugs. `no-store` costs an extra request per
 * fixture per navigation — trivial for files this size — in exchange for
 * never lying about what's on disk.
 */
function getJson<T>(path: string): Promise<T> {
  return fetch(path, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${path}`);
    return r.json();
  });
}

/** Reads the generated fixtures. Shapes match the REST contract exactly. */
export const fixtureSource: DataSource = {
  getTeam: () => getJson<Team>("/api/team.json"),
  getUsers: () => getJson<User[]>("/api/users.json"),
  getPlayers: () => getJson<Player[]>("/api/players.json"),

  async getPlayer(playerId) {
    const players = await getJson<Player[]>("/api/players.json");
    return players.find((p) => p.id === playerId);
  },

  getHome: (role) =>
    getJson<HomeSummary>(role === "coach" ? "/api/home-coach.json" : "/api/home-player.json"),

  async getSessions(playerId) {
    const all = await getJson<Session[]>("/api/sessions.json");
    return playerId ? all.filter((s) => s.playerId === playerId) : all;
  },

  async getSession(sessionId) {
    const all = await getJson<Session[]>("/api/sessions.json");
    return all.find((s) => s.id === sessionId);
  },

  async getPitches(sessionId) {
    const bySession = await getJson<Record<string, Pitch[]>>("/api/pitches.json");
    return bySession[sessionId] ?? [];
  },

  /**
   * Only a few pitches have full measurement payloads generated. Any other id
   * falls back to one of them so every row in the UI stays clickable while the
   * backend is still being built. Fallbacks are deterministically perturbed
   * from the id so two different picks (e.g. 陳OO vs 林OO on the compare page)
   * read as two distinct records rather than the same curve twice.
   *
   * The borrowed curves come with the template's own identity fields
   * (sessionId, pitch #, type, speed...) baked in — left alone, every
   * borrowed pitch would claim to belong to the template's session, which is
   * how a 林OO/王OO pitch used to show up labelled 陳OO. Those fields get
   * overlaid from the pitch's real record (in pitches.json) below so the
   * identity is always right even when the curve shape is borrowed.
   */
  async getPitch(pitchId) {
    const AVAILABLE = ["s_p_chen_20260824_p01", "s_p_chen_20260824_p07", "s_p_chen_20260819_p04", ...OBP_TRIALS];
    const id = AVAILABLE.includes(pitchId) ? pitchId : AVAILABLE[0];
    const template = await getJson<PitchDetail>(`/api/pitch/${id}.json`);
    const detail = pitchId === id ? template : varyPitch(template, pitchId);

    const bySession = await getJson<Record<string, Pitch[]>>("/api/pitches.json");
    for (const list of Object.values(bySession)) {
      const real = list.find((p) => p.id === pitchId);
      if (real) {
        return {
          ...detail,
          sessionId: real.sessionId,
          number: real.number,
          pitchType: real.pitchType,
          velocityKmh: real.velocityKmh,
          thrownAt: real.thrownAt,
          starred: real.starred,
          status: real.status,
        };
      }
    }
    return detail;
  },

  async getPose(pitchId) {
    const AVAILABLE = ["s_p_chen_20260824_p01", "s_p_chen_20260824_p07", "s_p_chen_20260819_p04", ...OBP_TRIALS];
    const id = AVAILABLE.includes(pitchId) ? pitchId : AVAILABLE[0];
    const pose = await getJson<PoseData>(`/api/pose/${id}.json`);
    return pitchId === id ? pose : varyPose(pose, pitchId);
  },
};

/**
 * Real backend. Endpoints line up one-to-one with the tables in
 * server/schema.sql. Swap `dataSource` below once these exist.
 */
export function httpSource(baseUrl: string): DataSource {
  const get = <T>(path: string) => getJson<T>(`${baseUrl}${path}`);
  return {
    getTeam: () => get<Team>("/team"),
    getUsers: () => get<User[]>("/users"),
    getPlayers: () => get<Player[]>("/players"),
    getPlayer: (id) => get<Player>(`/players/${id}`),
    getHome: (role) => get<HomeSummary>(`/home?role=${role}`),
    getSessions: (playerId) =>
      get<Session[]>(playerId ? `/sessions?playerId=${playerId}` : "/sessions"),
    getSession: (id) => get<Session>(`/sessions/${id}`),
    getPitches: (sessionId) => get<Pitch[]>(`/sessions/${sessionId}/pitches`),
    getPitch: (id) => get<PitchDetail>(`/pitches/${id}`),
    getPose: (id) => get<PoseData>(`/pitches/${id}/pose`),
  };
}

const API_BASE = import.meta.env.VITE_API_BASE as string | undefined;

export const dataSource: DataSource = API_BASE ? httpSource(API_BASE) : fixtureSource;
