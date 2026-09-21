/**
 * Convert one or more OpenBiomechanics pitching trials into the app's fixture
 * shape, and wire each one in as its own demo player + session + pitch.
 *
 *   node scripts/obp_to_fixture.mjs <scratchDir> <session_pitch> [session_pitch...]
 *
 * <scratchDir> must contain (extracted from the dataset-v1 release + repo):
 *   joint_angles.csv   landmarks.csv   poi_metrics.csv   metadata.csv
 * and should also contain, for real (not differentiated) velocity curves:
 *   joint_velos.csv
 *
 * The full-signal CSVs are large (tens–hundreds of MB), so this reads each
 * once and buckets rows for every requested trial in a single pass, however
 * many trials are given.
 *
 * Data © Driveline Baseball — OpenBiomechanics Project, CC BY-NC-SA 4.0.
 * Non-commercial use only. See public/api/pitch/OBP-NOTICE.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [scratch, ...trials] = process.argv.slice(2);
if (!scratch || trials.length === 0) {
  console.error("usage: node scripts/obp_to_fixture.mjs <scratchDir> <session_pitch> [session_pitch...]");
  process.exit(1);
}

const N = 120; // resampled frame count
// Every other fixture in this app plays 120 frames at 20fps (~6s) regardless
// of how much real time the capture spans — a real delivery is ~0.3s, and
// played back at *that* rate (as the first cut of this converter did) it's a
// blur. Slowing it to a fixed, watchable virtual fps is what every biomech
// review tool does; only the frame *positions* (event timing, curve shape)
// come from the real capture, not the playback speed.
const FPS = 20;

// user id → surname, one per wired-in OBP athlete (see the table in
// OBP-NOTICE.md). Anonymized the same way as this app's own synthetic
// players (陳OO / 林OO / 王OO) — pick a distinct surname when wiring in a
// new user id; anyone left out falls back to "OBP 示範投手 <id>".
const SURNAME_FOR = {
  750: "洪",
  1543: "邱",
  970: "曾",
  986: "楊",
  1596: "許",
  922: "鄭",
  1633: "謝",
  1000: "賴",
  906: "呂",
  822: "蔡",
  964: "吳",
  1689: "黃",
};

/* ------------------------------------------------------------------ csv */

const num = (v) => (v === "" || v === undefined ? null : Number(v));

/** Single pass over a (possibly huge) CSV, bucketing rows per wanted id. */
function readCsvForTrials(path, wanted) {
  const raw = readFileSync(resolve(scratch, path), "utf8");
  const nl = raw.indexOf("\n");
  const head = raw.slice(0, nl).trim().split(",");
  const byTrial = new Map(wanted.map((t) => [t, []]));
  const len = raw.length;
  let i = nl + 1;
  while (i < len) {
    let end = raw.indexOf("\n", i);
    if (end === -1) end = len;
    if (end > i) {
      const comma = raw.indexOf(",", i);
      const bucket = byTrial.get(raw.slice(i, comma));
      if (bucket) {
        const cells = raw.slice(i, end).split(",");
        const row = {};
        for (let k = 0; k < head.length; k++) row[head[k]] = cells[k];
        bucket.push(row);
      }
    }
    i = end + 1;
  }
  return byTrial;
}

function readSmallCsv(path) {
  const lines = readFileSync(resolve(scratch, path), "utf8").trim().split(/\r?\n/);
  const head = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const cells = l.split(",");
    const row = {};
    head.forEach((h, i) => (row[h] = cells[i]));
    return row;
  });
}

console.log(`reading joint_angles.csv / joint_velos.csv / landmarks.csv for ${trials.length} trial(s)…`);
const jaByTrial = readCsvForTrials("joint_angles.csv", trials);
const jvByTrial = readCsvForTrials("joint_velos.csv", trials);
const lmByTrial = readCsvForTrials("landmarks.csv", trials);
const poiRows = readSmallCsv("poi_metrics.csv");
const metaRows = readSmallCsv("metadata.csv");

/* ---------------------------------------------------- normative range (參考帶) */

/**
 * Normative range is a population standard, not something derived from
 * whichever trial happens to be converted — every pitch that shares a series
 * key gets the exact same refLower/refUpper curve, on purpose. Fixed here
 * (yMin, yMax, peak frame) per key, entirely independent of any one trial's
 * own samples/bounds(). No real cohort data behind it yet, so it's a bell
 * curve (same shape scripts/generate_fixtures.py uses) through that fixed
 * range, +-8% spread. Swap for a real cohort-derived band once one exists.
 *
 * Key set is this file's own (arm_angle etc. use different key names than
 * generate_fixtures.py's synthetic pitches — the two fixture families don't
 * share a series-key vocabulary), so this table is necessarily separate from
 * that one rather than shared.
 */
const NORMATIVE_RANGE = {
  pelvis_rotation_vel: [-100, 800, 95],
  torso_rotation_vel: [-100, 1000, 98],
  elbow_extension_vel: [-300, 2400, 100],
  shoulder_int_rot_vel: [-300, 5000, 100],
  elbow_flexion: [50, 110, 60],
  shoulder_er: [0, 180, 92],
  shoulder_abd: [60, 100, 60],
  shoulder_habd: [-40, 50, 40],
  elbow_flexion_vel: [-300, 2400, 100],
  shoulder_er_vel: [-300, 5000, 100],
  torso_ant_tilt: [-15, 40, 100],
  torso_lat_tilt: [-15, 25, 60],
  torso_ant_tilt_vel: [-350, 300, 95],
  torso_lat_tilt_vel: [-80, 270, 40],
  torso_rotation: [-30, 130, 95],
  hip_shoulder_sep: [0, 30, 70],
  torso_rotation_vel2: [-100, 1000, 98],
  hip_shoulder_sep_vel: [-500, 150, 60],
  lead_knee_flexion: [40, 65, 60],
  rear_knee_flexion: [35, 60, 30],
  lead_knee_ext_vel: [-200, 150, 60],
};

const NORMATIVE_FRAMES = 120;

/** Same bell-ish trace as scripts/generate_fixtures.py's curve(), fixed seed. */
function normativeCurve(yMin, yMax, peakAt) {
  const out = [];
  for (let i = 0; i < NORMATIVE_FRAMES; i++) {
    const t = i / NORMATIVE_FRAMES;
    const p = peakAt / NORMATIVE_FRAMES;
    const bell = Math.exp(-((t - p) ** 2) / 0.012);
    const wobble = 0.06 * Math.sin(t * Math.PI * 2 * 3.1);
    const v = 0.12 + 0.8 * bell + wobble;
    out.push(yMin + (yMax - yMin) * Math.max(0, Math.min(1, v)));
  }
  return out;
}

function normativeBand(key) {
  const [yMin, yMax, peakAt] = NORMATIVE_RANGE[key] ?? [0, 100, 60];
  const center = normativeCurve(yMin, yMax, peakAt);
  const spread = (yMax - yMin) * 0.08;
  const round1 = (n) => Math.round(n * 10) / 10;
  return {
    refLower: center.map((v) => round1(v - spread)),
    refUpper: center.map((v) => round1(v + spread)),
  };
}

/* -------------------------------------------------------------- 1 trial */

function convertTrial(trial) {
  const ja = jaByTrial.get(trial);
  const lm = lmByTrial.get(trial);
  const poi = poiRows.find((r) => r.session_pitch === trial);
  const meta = metaRows.find((r) => r.session_pitch === trial);
  if (!ja?.length || !lm?.length || !poi) {
    console.warn(`skip ${trial}: not found in one of the source CSVs`);
    return null;
  }

  const OUT_ID = `obp_${trial}`;
  const ev = {
    fp10: Number(ja[0].fp_10_time),
    fp: Number(ja[0].fp_100_time),
    mer: Number(ja[0].MER_time),
    br: Number(ja[0].BR_time),
  };
  // Focus on the delivery: from just before front-foot contact to just past release.
  const start = ev.fp10 - 0.09;
  const end = ev.br + 0.05;
  const dur = end - start;

  const jaTimes = ja.map((r) => Number(r.time));
  const lmTimes = lm.map((r) => Number(r.time));
  const sampler = (rows, times) => (col, t) => {
    if (t <= times[0]) return num(rows[0][col]);
    if (t >= times[times.length - 1]) return num(rows[rows.length - 1][col]);
    let i = 1;
    while (times[i] < t) i++;
    const a = num(rows[i - 1][col]);
    const b = num(rows[i][col]);
    if (a === null || b === null) return a ?? b;
    const f = (t - times[i - 1]) / (times[i] - times[i - 1]);
    return a + (b - a) * f;
  };
  const atJa = sampler(ja, jaTimes);
  const atLm = sampler(lm, lmTimes);

  // Real measured angular velocity (joint_velos.csv) when present, so the
  // velocity curves are the mocap pipeline's own signal rather than a naive
  // numerical derivative of the angle curve. Falls back to differentiation
  // if that file wasn't downloaded — it's optional, unlike the other three.
  const jv = jvByTrial.get(trial);
  const hasRealVelo = Boolean(jv?.length);
  const atJv = hasRealVelo ? sampler(jv, jv.map((r) => Number(r.time))) : null;

  const frameTimes = Array.from({ length: N }, (_, k) => start + (k / (N - 1)) * dur);
  const frameOf = (t) => Math.round(((t - start) / dur) * (N - 1));

  /* ------------------------------------------------------------- series */

  const dt = dur / (N - 1);
  const derive = (arr) =>
    arr.map((_, i) => {
      if (i === 0) return (arr[1] - arr[0]) / dt;
      if (i === arr.length - 1) return (arr[i] - arr[i - 1]) / dt;
      return (arr[i + 1] - arr[i - 1]) / (2 * dt);
    });
  const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10);
  const bounds = (...series) => {
    const all = series.flat().filter((v) => v !== null);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const pad = (hi - lo) * 0.12 || 10;
    const step = 10;
    return { yMin: Math.floor((lo - pad) / step) * step, yMax: Math.ceil((hi + pad) / step) * step };
  };

  const col = (c) => frameTimes.map((t) => atJa(c, t));
  const shoulderAxis = ["shoulder_angle_x", "shoulder_angle_y", "shoulder_angle_z"]
    .map((c) => ({ c, v: Math.abs(atJa(c, ev.mer)) }))
    .sort((a, b) => b.v - a.v)[0].c;
  const shoulderVeloAxis = shoulderAxis.replace("_angle_", "_velo_");

  /** Real measured velocity for `veloCol` if available, else derive `angleArr`. */
  const colV = (veloCol, angleArr, sign = 1) =>
    hasRealVelo
      ? frameTimes.map((t) => {
          const v = atJv(veloCol, t);
          return v === null ? null : v * sign;
        })
      : derive(angleArr).map((v) => v * sign);

  const raw = {
    elbowFlex: col("elbow_angle_x"),
    shoulderER: col(shoulderAxis),
    shoulderAbd: col("shoulder_angle_y"),
    shoulderHabd: col("shoulder_angle_x"),
    torsoTilt: col("torso_angle_x"),
    torsoLat: col("torso_angle_y"),
    torsoRot: col("torso_angle_z"),
    hipShoulder: col("torso_pelvis_angle_z"),
    pelvisRot: col("pelvis_angle_z"),
    leadKnee: col("lead_knee_angle_x"),
    rearKnee: col("rear_knee_angle_x"),
  };

  const S = (key, group, label, labelEn, unit, color, samples) => {
    const { yMin, yMax } = bounds(samples);
    return {
      key,
      group,
      label,
      labelEn,
      unit,
      color,
      samples: samples.map(round1),
      ...normativeBand(key), // fixed per key — see NORMATIVE_RANGE above, not derived from this trial
      yMin,
      yMax,
    };
  };

  const RED = "#e5262b", BLUE = "#1f5fd0", GREEN = "#14a35a", ORANGE = "#f08019";

  const series = [
    S("pelvis_rotation_vel", "phase_sequencing", "骨盆旋轉角速度", "Pelvis Rotation", "deg/sec", BLUE, colV("pelvis_velo_z", raw.pelvisRot)),
    S("torso_rotation_vel", "phase_sequencing", "軀幹旋轉角速度", "Torso Rotation", "deg/sec", RED, colV("torso_velo_z", raw.torsoRot)),
    S("elbow_extension_vel", "phase_sequencing", "手肘伸展角速度", "Elbow Extension", "deg/sec", GREEN, colV("elbow_velo_x", raw.elbowFlex)),
    S("shoulder_int_rot_vel", "phase_sequencing", "肩內旋角速度", "Shoulder Int. Rotation", "deg/sec", ORANGE, colV(shoulderVeloAxis, raw.shoulderER)),

    S("elbow_flexion", "arm_angle", "手肘屈曲", "Elbow Flexion", "deg", "#8e2fc0", raw.elbowFlex),
    S("shoulder_er", "arm_angle", "肩外旋 (MER)", "External Rotation / MER", "deg", RED, raw.shoulderER),
    S("shoulder_abd", "arm_angle", "肩外展", "Abduction", "deg", BLUE, raw.shoulderAbd),
    S("shoulder_habd", "arm_angle", "水平外展", "Horizontal Abduction", "deg", GREEN, raw.shoulderHabd),

    S("elbow_flexion_vel", "arm_velocity", "手肘屈曲角速度", "Elbow Flexion Velocity", "deg/sec", "#8e2fc0", colV("elbow_velo_x", raw.elbowFlex)),
    S("shoulder_er_vel", "arm_velocity", "肩外旋角速度", "Ext. Rotation Velocity", "deg/sec", RED, colV(shoulderVeloAxis, raw.shoulderER)),

    S("torso_ant_tilt", "trunk_flexion_angle", "軀幹前傾", "Anterior Tilt", "deg", BLUE, raw.torsoTilt),
    S("torso_lat_tilt", "trunk_flexion_angle", "軀幹側傾", "Lateral Tilt", "deg", ORANGE, raw.torsoLat),
    S("torso_ant_tilt_vel", "trunk_flexion_velocity", "軀幹前傾角速度", "Anterior Tilt Velocity", "deg/sec", BLUE, colV("torso_velo_x", raw.torsoTilt)),
    S("torso_lat_tilt_vel", "trunk_flexion_velocity", "軀幹側傾角速度", "Lateral Tilt Velocity", "deg/sec", ORANGE, colV("torso_velo_y", raw.torsoLat)),

    S("torso_rotation", "trunk_twist_angle", "軀幹旋轉", "Torso Rotation", "deg", RED, raw.torsoRot),
    S("hip_shoulder_sep", "trunk_twist_angle", "髖肩分離", "Hip-Shoulder Separation", "deg", GREEN, raw.hipShoulder),
    S("torso_rotation_vel2", "trunk_twist_velocity", "軀幹旋轉角速度", "Torso Rotation Velocity", "deg/sec", RED, colV("torso_velo_z", raw.torsoRot)),
    S("hip_shoulder_sep_vel", "trunk_twist_velocity", "髖肩分離角速度", "Hip-Shoulder Sep. Velocity", "deg/sec", GREEN, colV("torso_pelvis_velo_z", raw.hipShoulder)),

    S("lead_knee_flexion", "knee_angle", "前腳膝屈曲", "Lead Knee Flexion", "deg", BLUE, raw.leadKnee),
    S("rear_knee_flexion", "knee_angle", "後腳膝屈曲", "Rear Knee Flexion", "deg", ORANGE, raw.rearKnee),
    S("lead_knee_ext_vel", "knee_velocity", "前腳膝伸展角速度", "Lead Knee Ext. Velocity", "deg/sec", BLUE, colV("lead_knee_velo_x", raw.leadKnee)),
  ];

  /* ------------------------------------------------------------ scalars */

  const P = (k) => num(poi[k]);
  const sc = (key, group, label, labelEn, unit, value, refMin, refMax, atEvent, hint) => ({
    key,
    group,
    label,
    labelEn,
    unit,
    value: value === null ? null : Math.round(value * 10) / 10,
    refMin,
    refMax,
    atEvent,
    hint,
  });

  // summary 欄位跟 scripts/generate_fixtures.py 的假資料共用同一套 9 個 key，
  // 兩邊 UI 才會長一樣。sequencing/efficiency/arm_path/hand_speed/deception
  // 這 5 項在 OBP 的 poi_metrics.csv 裡沒有對應欄位，也還沒有可以從
  // joint_angles/joint_velos/landmarks 算出這幾個指標的公式，所以先填固定
  // 假數值頂著——等真的公式做出來再換成算出來的值。
  const scalars = [
    sc("sequencing", "summary", "動力鏈分序", "Sequencing", "%", 75, 0, 100, null, "四段旋轉是否依序由下而上傳遞。"),
    sc("efficiency", "summary", "能量效率", "Efficiency", "%", 24, 0, 100, null, "動力鏈由下而上傳遞能量的效率。"),
    sc("arm_path", "summary", "手臂路徑", "Arm Path", "%", 62, 0, 100, null, "手臂行進路徑的一致性。"),
    sc("hand_speed", "summary", "手部速度", "Hand Speed", "Mph", 78, 50, 95, "br", "球出手瞬間的手部線速度。"),
    sc("torque", "summary", "肘關節力矩", "Torque", "Nm", P("elbow_varus_moment"), 40, 160, "mer", "肘關節外翻力矩，與受傷風險相關。"),
    sc("deception", "summary", "隱蔽性", "Deception", "ms", 38, 20, 60, "br", "打者可見球的時間，越短越難辨識。"),
    sc("stride_length", "summary", "跨步距離", "Stride Length", "%BH", P("stride_length") * 100, 60, 110, "fp", "跨步距離佔身高比例。"),
    sc("hip_shoulder", "summary", "最大髖肩分離", "Hip-shoulder Sep", "deg", P("max_rotation_hip_shoulder_separation"), 20, 60, "fp", "骨盆與軀幹旋轉的最大分離角。"),
    sc("external_rot", "summary", "最大外旋", "External Rot.", "deg", P("max_shoulder_external_rotation"), 130, 190, "mer", "肩關節最大外旋角（layback）。"),

    sc("elbow_angle", "joint_angle", "MER 時手肘屈曲", "Elbow Flexion @ MER", "deg", P("elbow_flexion_mer"), 70, 120, "mer", "最大外旋瞬間的手肘屈曲角。"),
    sc("torso_angle", "joint_angle", "出手時軀幹旋轉", "Torso Rotation @ BR", "deg", P("torso_rotation_br"), 80, 140, "br", "球出手瞬間的軀幹旋轉角。"),
    sc("pelvis_angle", "joint_angle", "著地時骨盆旋轉", "Pelvis Rotation @ FP", "deg", P("pelvis_rotation_fp"), 10, 55, "fp", "前腳著地瞬間的骨盆旋轉角。"),
    sc("shoulder_angle", "joint_angle", "著地時肩外展", "Shoulder Abduction @ FP", "deg", P("shoulder_abduction_fp"), 70, 110, "fp", "前腳著地瞬間的肩外展角。"),

    sc("release_ext", "release", "前腳膝伸展 (著地→出手)", "Lead Knee Ext. FP→BR", "deg", P("lead_knee_extension_from_fp_to_br"), -10, 40, "br", "著地到出手之間前腳膝關節的伸展量。"),
    sc("release_height", "release", "出手時軀幹前傾", "Torso Ant. Tilt @ BR", "deg", P("torso_anterior_tilt_br"), 15, 45, "br", "球出手瞬間的軀幹前傾角。"),
    sc("release_side", "release", "出手時軀幹側傾", "Torso Lateral Tilt @ BR", "deg", P("torso_lateral_tilt_br"), 5, 40, "br", "球出手瞬間的軀幹側傾角。"),
  ];

  /* -------------------------------------------------------------- pitch */

  const pitch = {
    id: OUT_ID,
    sessionId: `s_obp_${trial.split("_")[0]}`,
    number: 1,
    pitchType: poi.pitch_type === "FF" ? "四縫線速球" : poi.pitch_type,
    velocityKmh: Math.round(P("pitch_speed_mph") * 1.60934 * 10) / 10,
    status: "done",
    thrownAt: "2023-01-01T10:00:00+08:00",
    frameCount: N,
    fps: FPS,
    events: { fps: 0, fp: frameOf(ev.fp), mer: frameOf(ev.mer), br: frameOf(ev.br) },
    starred: true,
    // 8 機位 slots, all null — OBP trials have pose data but no video capture.
    media: { videoUrls: Array(8).fill(null), poseUrl: `/api/pose/${OUT_ID}.json`, width: 1920, height: 1080 },
    scalars,
    series,
  };

  /* --------------------------------------------------------------- pose */

  const JOINTS = [
    ["head", "thorax_prox"],
    ["neck", "thorax_prox"],
    ["rShoulder", "shoulder_jc"],
    ["rElbow", "elbow_jc"],
    ["rWrist", "wrist_jc"],
    ["rHand", "hand_jc"],
    ["lShoulder", "glove_shoulder_jc"],
    ["lElbow", "glove_elbow_jc"],
    ["lWrist", "glove_wrist_jc"],
    ["pelvis", null],
    ["rHip", "rear_hip"],
    ["rKnee", "rear_knee_jc"],
    ["rAnkle", "rear_ankle_jc"],
    ["lHip", "lead_hip"],
    ["lKnee", "lead_knee_jc"],
    ["lAnkle", "lead_ankle_jc"],
  ];
  const idx = Object.fromEntries(JOINTS.map(([n], i) => [n, i]));
  const BONES = [
    ["neck", "head"], ["neck", "rShoulder"], ["neck", "lShoulder"],
    ["rShoulder", "rElbow"], ["rElbow", "rWrist"], ["rWrist", "rHand"],
    ["lShoulder", "lElbow"], ["lElbow", "lWrist"],
    ["neck", "pelvis"], ["pelvis", "rHip"], ["rHip", "rKnee"], ["rKnee", "rAnkle"],
    ["pelvis", "lHip"], ["lHip", "lKnee"], ["lKnee", "lAnkle"],
  ].map(([a, b]) => [idx[a], idx[b]]);

  const round4 = (n) => Math.round(n * 1e4) / 1e4;

  // A fixed leg-length reference for the whole trial (averaged, so one noisy
  // frame's marker jitter doesn't move it) — a person's actual limb length
  // doesn't change during a pitch, so this is the one true scale.
  const legLenSamples = frameTimes.map((t) => {
    const g = (base) => [atLm(`${base}_x`, t), atLm(`${base}_y`, t), atLm(`${base}_z`, t)];
    const rHip = g("rear_hip");
    const lHip = g("lead_hip");
    const pelvis = [(rHip[0] + lHip[0]) / 2, (rHip[1] + lHip[1]) / 2, (rHip[2] + lHip[2]) / 2];
    const rAnk = g("rear_ankle_jc");
    return Math.hypot(pelvis[0] - rAnk[0], pelvis[1] - rAnk[1], pelvis[2] - rAnk[2]) || 1;
  });
  const legLen = legLenSamples.reduce((a, b) => a + b, 0) / legLenSamples.length;

  function jointsAt(t) {
    const g = (base) => [atLm(`${base}_x`, t), atLm(`${base}_y`, t), atLm(`${base}_z`, t)];
    const rHip = g("rear_hip");
    const lHip = g("lead_hip");
    const pelvis = [(rHip[0] + lHip[0]) / 2, (rHip[1] + lHip[1]) / 2, (rHip[2] + lHip[2]) / 2];
    return JOINTS.map(([name, base]) => {
      let p;
      if (name === "pelvis") p = pelvis;
      else if (name === "head") {
        const prox = g("thorax_prox");
        p = [prox[0], prox[1], prox[2] + legLen * 0.28];
      } else if (name === "neck") p = g("thorax_prox");
      else p = g(base);
      return [(p[0] - pelvis[0]) / legLen, (p[2] - pelvis[2]) / legLen, (p[1] - pelvis[1]) / legLen];
    });
  }

  const pts3ByFrame = frameTimes.map(jointsAt);

  // Fixed camera: one 2D viewport for the whole clip (real capture is a
  // stationary camera), not re-fit to each frame's bounding box — refitting
  // per frame is what made the skeleton visibly zoom in and out as the body's
  // silhouette grew and shrank through the delivery.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pts3 of pts3ByFrame) {
    for (const [x, y] of pts3) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const span = Math.max(maxX - minX, maxY - minY) * 1.25 || 1;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

  const frames = pts3ByFrame.map((pts3) => ({
    joints2d: pts3.map(([x, y]) => [round4(0.5 + (x - cx) / span), round4(0.5 - (y - cy) / span)]),
    joints3d: pts3.map(([x, y, z]) => [round4(x), round4(y), round4(z)]),
  }));

  const pose = { jointNames: JOINTS.map(([n]) => n), bones: BONES, frames };

  /* ------------------------------------------------------------- player */

  // metadata.csv has three ids per row: `user` (persistent athlete, stable
  // across visits), `session` (one visit — a bullpen, say), `session_pitch`
  // (one pitch in that visit). A player here is one `user`; a `session` of
  // theirs can hold several pitches, which is what lets the same demo player
  // show up with more than one real trial instead of exactly one.
  const userId = meta ? meta.user : trial.split("_")[0];
  // Real names aren't in this dataset (it's anonymized) — but "OBP 示範投手
  // <id>" reads as unfinished placeholder text, not a name. Anonymized the
  // same way as the app's own synthetic players (surname + OO) instead, so
  // an OBP player looks like any other roster entry, not a data-source label.
  const name = SURNAME_FOR[userId] ? `${SURNAME_FOR[userId]}OO` : `OBP 示範投手 ${userId}`;
  const sessionNum = meta ? meta.session : trial.split("_")[0];
  const pitchNum = Number(trial.split("_")[1]) || 1;
  const heightM = meta ? Number(meta.session_height_m) : null;
  const weightKg = meta ? Number(meta.session_mass_kg) : null;
  const ageYrs = meta ? Number(meta.age_yrs) : null;
  const birthYear = ageYrs ? 2023 - Math.floor(ageYrs) : 2000;

  const player = {
    id: `p_obp_${userId}`,
    teamId: "team_ntsu",
    name,
    avatarUrl: null,
    heightCm: heightM ? Math.round(heightM * 100) : 180,
    weightKg: weightKg ? Math.round(weightKg) : 85,
    throws: poi.p_throws === "L" ? "L" : "R",
    birthDate: `${birthYear}-01-01`,
  };

  const session = {
    id: `s_obp_${sessionNum}`,
    playerId: player.id,
    playerName: player.name,
    date: "2023-01-01",
    label: "OpenBiomechanics 真實資料",
    status: "done",
    pitchCount: 1, // overwritten once all of this session's pitches are grouped, below
  };

  const listing = {
    id: pitch.id,
    sessionId: session.id,
    number: pitchNum,
    pitchType: pitch.pitchType,
    velocityKmh: pitch.velocityKmh,
    status: "done",
    thrownAt: pitch.thrownAt,
    frameCount: pitch.frameCount,
    fps: pitch.fps,
    events: pitch.events,
    starred: pitchNum === 1,
  };

  return { pitch, pose, player, session, listing, summary: { trial, mph: P("pitch_speed_mph"), hand: poi.p_throws, mer: P("max_shoulder_external_rotation") } };
}

/* ---------------------------------------------------------------- run */

const results = trials.map(convertTrial).filter(Boolean);

const apiDir = resolve(process.cwd(), "public/api");
for (const r of results) {
  writeFileSync(resolve(apiDir, `pitch/${r.pitch.id}.json`), JSON.stringify(r.pitch));
  writeFileSync(resolve(apiDir, `pose/${r.pitch.id}.json`), JSON.stringify(r.pose));
}

// Group trials by session — several results can share one session.id when
// the same athlete threw more than one of the requested pitches.
const bySessionId = new Map();
for (const r of results) {
  if (!bySessionId.has(r.session.id)) bySessionId.set(r.session.id, []);
  bySessionId.get(r.session.id).push(r);
}
const sessionGroups = [...bySessionId.values()].map((group) => {
  const listings = group.map((r) => r.listing).sort((a, b) => a.number - b.number);
  return { player: group[0].player, session: { ...group[0].session, pitchCount: listings.length }, listings };
});

function mergeJson(path, updater) {
  const full = resolve(apiDir, path);
  const current = JSON.parse(readFileSync(full, "utf8"));
  writeFileSync(full, JSON.stringify(updater(current)));
}

mergeJson("players.json", (players) => [
  ...players.filter((p) => !p.id.startsWith("p_obp_")),
  ...sessionGroups.map((g) => g.player),
]);
mergeJson("sessions.json", (sessions) => [
  ...sessionGroups.map((g) => g.session),
  ...sessions.filter((s) => !s.id.startsWith("s_obp_")),
]);
mergeJson("pitches.json", (pitches) => {
  const next = { ...pitches };
  for (const key of Object.keys(next)) if (key.startsWith("s_obp_")) delete next[key];
  for (const g of sessionGroups) next[g.session.id] = g.listings;
  return next;
});

console.log(`\nwrote ${results.length} trial(s) across ${sessionGroups.length} session(s):`);
for (const g of sessionGroups) {
  console.log(`  ${g.player.name.padEnd(18)} ${g.session.id}  ${g.listings.length} pitch(es): ${g.listings.map((l) => l.id).join(", ")}`);
}
console.log("\nAdd these ids to the AVAILABLE arrays in src/api/dataSource.ts:");
console.log("  " + results.map((r) => `"${r.pitch.id}"`).join(", "));
