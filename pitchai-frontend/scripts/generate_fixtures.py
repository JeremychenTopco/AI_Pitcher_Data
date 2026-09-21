#!/usr/bin/env python3
"""Generates the JSON fixtures under public/api.

Every measurement in the flowchart gets exactly one sample value so the UI can
be built against realistic shapes before the MySQL backend exists. The output
matches src/api/types.ts field for field.

Run this BEFORE scripts/obp_to_fixture.mjs, not after. This script overwrites
players.json / sessions.json / pitches.json / measurements.json wholesale with
just the synthetic roster (p_chen etc.); obp_to_fixture.mjs merges the real
OBP athletes into whatever is already in those files. Running this script
after obp_to_fixture.mjs silently wipes the OBP roster back out.
"""
import json
import math
import os
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "api")
os.makedirs(OUT, exist_ok=True)

FRAMES = 120
FPS = 20

RED, BLUE, GREEN, ORANGE = "#e5262b", "#1f5fd0", "#14a35a", "#f08019"

# ------------------------------------------------------------ 線性資料 catalogue
SERIES_DEFS = [
    # key, group, zh, en, unit, color, yMin, yMax
    ("pelvis_rotation_vel",  "phase_sequencing", "骨盆旋轉角速度", "Pelvis Rotation",             "deg/sec", BLUE,   -200, 900),
    ("torso_rotation_vel",   "phase_sequencing", "軀幹旋轉角速度", "Torso Rotation",              "deg/sec", ORANGE, -200, 1200),
    ("elbow_extension_vel",  "phase_sequencing", "手肘伸展角速度", "Elbow Extension",             "deg/sec", GREEN,  -200, 2400),
    ("shoulder_int_rot_vel", "phase_sequencing", "肩內旋角速度",   "Shoulder Internal Rotation",  "deg/sec", RED,    -200, 7000),

    ("elbow_flexion",        "arm_angle", "手肘屈曲",   "Elbow Flexion",          "deg", RED,      0, 150),
    ("shoulder_mer",         "arm_angle", "肩外旋",     "External Rotation / MER","deg", GREEN,    0, 180),
    ("shoulder_abduction",   "arm_angle", "肩外展",     "Abduction",              "deg", BLUE,     0, 150),
    ("horizontal_abduction", "arm_angle", "水平外展",   "Horizontal Abduction",   "deg", ORANGE, -60, 90),

    ("elbow_extension",      "arm_velocity", "肘關節伸展", "Elbow Extension",        "deg/sec", RED,    -500, 2500),
    ("internal_rotation",    "arm_velocity", "內旋",       "Internal Rotation",      "deg/sec", BLUE,   -500, 7500),
    ("abduction_vel",        "arm_velocity", "外展",       "Abduction",              "deg/sec", GREEN,  -600, 900),
    ("horiz_abduction_vel",  "arm_velocity", "水平外展",   "Horizontal Abduction",   "deg/sec", ORANGE, -700, 800),

    ("trunk_forward",        "trunk_flexion_angle", "屈曲", "Forward", "deg", BLUE,   -30, 60),
    ("trunk_lateral",        "trunk_flexion_angle", "側傾", "Lateral", "deg", ORANGE, -50, 50),

    ("twist_pelvis",         "trunk_twist_angle", "骨盆",     "Pelvis",                   "deg", BLUE,   -90, 90),
    ("twist_torso",          "trunk_twist_angle", "軀幹",     "Torso",                    "deg", ORANGE, -90, 90),
    ("hip_shoulder_sep",     "trunk_twist_angle", "髖肩分離", "Hip-Shoulder Separation",  "deg", GREEN,  -20, 70),

    ("trunk_forward_vel",    "trunk_flexion_velocity", "屈曲", "Forward", "deg/sec", BLUE,   -400, 600),
    ("trunk_lateral_vel",    "trunk_flexion_velocity", "側傾", "Lateral", "deg/sec", ORANGE, -400, 400),

    ("twist_pelvis_vel",     "trunk_twist_velocity", "骨盆",     "Pelvis",                  "deg/sec", BLUE,   -200, 900),
    ("twist_torso_vel",      "trunk_twist_velocity", "軀幹",     "Torso",                   "deg/sec", ORANGE, -200, 1200),
    ("hip_shoulder_sep_vel", "trunk_twist_velocity", "髖肩分離", "Hip-Shoulder Separation", "deg/sec", GREEN,  -300, 500),

    ("knee_flexion",         "knee_angle",    "膝關節屈曲",     "Knee Flexion Angle",     "deg",     GREEN, 0, 90),
    ("knee_extension_vel",   "knee_velocity", "膝關節伸展角速度", "Knee Extension Velocity","deg/sec", BLUE, -600, 600),
]

# ------------------------------------------------------------- 單一值 catalogue
SCALAR_DEFS = [
    # key, group, zh, en, unit, value, refMin, refMax, atEvent, hint
    ("sequencing",     "summary", "動力鏈分序", "Sequencing",       "%",   75,  0, 100, None,  "四段旋轉是否依序由下而上傳遞。"),
    ("efficiency",     "summary", "能量效率",   "Efficiency",       "%",   24,  0, 100, None,  "動力鏈由下而上傳遞能量的效率。"),
    ("arm_path",       "summary", "手臂路徑",   "Arm Path",         "%",   62,  0, 100, None,  "手臂行進路徑的一致性。"),
    ("hand_speed",     "summary", "手部速度",   "Hand Speed",       "Mph", 78, 50, 95,  "br",  "球出手瞬間的手部線速度。"),
    ("torque",         "summary", "肘關節力矩", "Torque",           "Nm",  54, 40, 160, "mer", "肘關節外翻力矩，與受傷風險相關。"),
    ("deception",      "summary", "隱蔽性",     "Deception",        "ms",  38, 20, 60,  "br",  "打者可見球的時間，越短越難辨識。"),
    ("stride_length",  "summary", "跨步距離",   "Stride Length",    "%BH", 87, 60, 110, "fp",  "跨步距離佔身高的比例。"),
    ("hip_shoulder",   "summary", "最大髖肩分離", "Hip-shoulder Sep", "deg", 43, 20, 60,  "fp",  "骨盆與軀幹旋轉的最大分離角度。"),
    ("external_rot",   "summary", "最大外旋",   "External Rot.",    "deg", 168, 130, 190, "mer", "肩關節最大外旋角度。"),

    ("pelvis_angle",   "joint_angle", "骨盆", "Pelvis",   "deg", 108, 0, 180, "fp", "此刻骨盆旋轉角度。"),
    ("torso_angle",    "joint_angle", "軀幹", "Torso",    "deg",  97, 0, 180, "fp", "此刻軀幹旋轉角度。"),
    ("elbow_angle",    "joint_angle", "手肘", "Elbow",    "deg",  31, 0, 150, "fp", "此刻手肘屈曲角度。"),
    ("shoulder_angle", "joint_angle", "肩膀", "Shoulder", "deg",  46, 0, 180, "fp", "此刻肩關節外展角度。"),

    ("release_height", "release", "出手點高度", "Release Height",  "cm", 178, 140, 210, "br", "球出手時的離地高度。"),
    ("release_side",   "release", "出手點側偏", "Release Side",    "cm",  32, -20, 70, "br", "球出手時距離身體中線的水平位移。"),
    ("release_ext",    "release", "出手點延伸", "Release Extension","cm", 189, 140, 220, "br", "球出手時距離投手板的前伸距離。"),
]

EVENTS = {"fps": 30, "fp": 46, "mer": 74, "br": 82}


def curve(seed, y_min, y_max, peak_at):
    """A plausible bell-ish trace peaking near `peak_at`, scaled into range."""
    out = []
    for i in range(FRAMES):
        t = i / FRAMES
        p = peak_at / FRAMES
        bell = math.exp(-((t - p) ** 2) / 0.012)
        wobble = 0.06 * math.sin(t * math.pi * 2 * 3.1 + seed)
        v = 0.12 + 0.8 * bell + wobble
        out.append(round(y_min + (y_max - y_min) * max(0.0, min(1.0, v)), 2))
    return out


def build_series(seed_offset=0.0):
    out = []
    peaks = {
        "phase_sequencing": {"pelvis_rotation_vel": 50, "torso_rotation_vel": 58,
                             "elbow_extension_vel": 72, "shoulder_int_rot_vel": 80},
    }
    for idx, (key, group, zh, en, unit, color, y_min, y_max) in enumerate(SERIES_DEFS):
        peak = peaks.get(group, {}).get(key, 60 + (idx % 5) * 4)
        samples = curve(idx * 1.7 + seed_offset, y_min, y_max, peak)
        # Normative range (參考帶) — a population standard has to be the same
        # curve for every pitch, so it's built from a fixed seed (0), never
        # from `seed_offset`, and never from this pitch's own `samples`. No
        # real cohort data behind it yet, so it's this pitch-independent
        # curve +-8% of the axis range. scripts/obp_to_fixture.mjs mirrors
        # this same "fixed per key, independent of any one trial" rule for
        # real pitches (necessarily a separate table there — the two fixture
        # families don't share series keys).
        reference = curve(idx * 1.7, y_min, y_max, peak)
        spread = (y_max - y_min) * 0.08
        out.append({
            "key": key,
            "group": group,
            "label": zh,
            "labelEn": en,
            "unit": unit,
            "color": color,
            "samples": samples,
            "refLower": [round(v - spread, 2) for v in reference],
            "refUpper": [round(v + spread, 2) for v in reference],
            "yMin": y_min,
            "yMax": y_max,
        })
    return out


def build_scalars(jitter=0.0):
    out = []
    for key, group, zh, en, unit, value, ref_min, ref_max, at_event, hint in SCALAR_DEFS:
        v = value if jitter == 0 else round(value * (1 + jitter), 1)
        # Keep fixtures inside their own reference range so the marker never
        # renders off the end of the bar.
        v = max(ref_min, min(ref_max, v))
        out.append({
            "key": key,
            "group": group,
            "label": zh,
            "labelEn": en,
            "unit": unit,
            "value": v,
            "refMin": ref_min,
            "refMax": ref_max,
            "atEvent": at_event,
            "hint": hint,
        })
    return out


# ----------------------------------------------------------------- pose data
BONES = [
    [0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7],
    [1, 8], [8, 9], [9, 10], [10, 11], [8, 12], [12, 13], [13, 14],
]
JOINT_NAMES = ["head", "neck", "r_shoulder", "r_elbow", "r_wrist",
               "l_shoulder", "l_elbow", "l_wrist", "pelvis",
               "r_hip", "r_knee", "r_ankle", "l_hip", "l_knee", "l_ankle"]


def pose_frames():
    frames = []
    for i in range(FRAMES):
        t = i / FRAMES
        # Stride: front leg travels forward, then plants at FP.
        stride = min(1.0, max(0.0, (t - 0.1) / 0.28))
        # Arm: cocks back, reaches MER, then whips through to release.
        arm = math.sin((t - 0.25) * math.pi * 1.9) if t > 0.25 else -0.4
        rot = min(1.0, max(0.0, (t - 0.35) / 0.35))

        j2 = [
            [0.50, 0.10 - 0.01 * rot],                    # head
            [0.50, 0.20],                                 # neck
            [0.50 + 0.07 * (1 - rot), 0.24],              # r shoulder
            [0.50 + 0.14 + 0.06 * arm, 0.20 - 0.05 * arm],# r elbow
            [0.50 + 0.20 + 0.14 * arm, 0.12 - 0.09 * arm],# r wrist
            [0.50 - 0.08 + 0.03 * rot, 0.24],             # l shoulder
            [0.50 - 0.14, 0.33],                          # l elbow
            [0.50 - 0.12, 0.43],                          # l wrist
            [0.50, 0.50],                                 # pelvis
            [0.54, 0.51],                                 # r hip
            [0.56, 0.70],                                 # r knee
            [0.55, 0.90],                                 # r ankle
            [0.46, 0.51],                                 # l hip
            [0.44 - 0.10 * stride, 0.70],                 # l knee
            [0.42 - 0.20 * stride, 0.90],                 # l ankle
        ]
        j3 = [[round(x * 2 - 1, 4), round(1 - y, 4), round(0.15 * math.sin(t * 6 + k), 4)]
              for k, (x, y) in enumerate(j2)]
        frames.append({
            "joints2d": [[round(x, 4), round(y, 4)] for x, y in j2],
            "joints3d": j3,
        })
    return frames


# ---------------------------------------------------------------- write out
def write(name, payload):
    path = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  {os.path.relpath(path, ROOT)}  ({os.path.getsize(path) // 1024} KB)")


def pitch_record(pid, session_id, number, thrown_at, status="done", velocity=148.0):
    return {
        "id": pid,
        "sessionId": session_id,
        "number": number,
        "pitchType": "直球",
        "velocityKmh": velocity,
        "status": status,
        "thrownAt": thrown_at,
        "frameCount": FRAMES,
        "fps": FPS,
        "events": EVENTS if status == "done" else {"fp": 0, "mer": 0, "br": 0},
        "starred": number == 1,
    }


def main():
    print("writing fixtures:")

    team = {"id": "team_ntsu", "name": "NTSU 棒球隊"}
    players = [
        {"id": "p_chen", "teamId": "team_ntsu", "name": "陳OO", "avatarUrl": None,
         "heightCm": 178, "weightKg": 76, "throws": "R", "birthDate": "2004-03-12"},
        {"id": "p_lin", "teamId": "team_ntsu", "name": "林OO", "avatarUrl": None,
         "heightCm": 182, "weightKg": 82, "throws": "L", "birthDate": "2003-11-02"},
        {"id": "p_wang", "teamId": "team_ntsu", "name": "王OO", "avatarUrl": None,
         "heightCm": 175, "weightKg": 71, "throws": "R", "birthDate": "2005-06-25"},
    ]
    users = [
        {"id": "u_coach", "role": "coach", "name": "張教練",
         "email": "coach@example.com", "playerId": None, "teamId": "team_ntsu"},
        {"id": "u_player", "role": "player", "name": "陳OO",
         "email": "chen@example.com", "playerId": "p_chen", "teamId": "team_ntsu"},
    ]

    dates = ["2026-08-24", "2026-08-23", "2026-08-22", "2026-08-21", "2026-08-20", "2026-08-19"]
    counts = [18, 3, 15, 4, 1, 18]
    sessions = []
    pitches_by_session = {}
    random.seed(7)

    for player in players:
        for d, c in zip(dates, counts):
            sid = f"s_{player['id']}_{d.replace('-', '')}"
            sessions.append({
                "id": sid, "playerId": player["id"], "playerName": player["name"],
                "date": d, "label": "牛棚投球", "status": "done", "pitchCount": c,
            })
            rows = []
            for n in range(1, c + 1):
                status = "processing" if (player["id"] == "p_lin" and d == dates[0] and n == 3) else "done"
                rows.append(pitch_record(
                    f"{sid}_p{n:02d}", sid, n,
                    f"{d}T08:{30 + n:02d}:00+08:00", status,
                    round(140 + random.random() * 12, 1),
                ))
            pitches_by_session[sid] = rows

    write("team.json", team)
    write("players.json", players)
    write("users.json", users)
    write("sessions.json", sessions)
    write("pitches.json", pitches_by_session)

    write("home-coach.json", {
        "processingCount": 5, "weekCount": 5, "pendingCount": 5,
        "recentSessions": [s for s in sessions if s["date"] == dates[0]][:3],
    })
    write("home-player.json", {
        "processingCount": 1, "weekCount": 5, "pendingCount": 2,
        "recentSessions": [s for s in sessions if s["playerId"] == "p_chen"][:3],
    })

    write("measurements.json", {
        "series": [{"key": k, "group": g, "label": zh, "labelEn": en,
                    "unit": u, "color": c, "yMin": lo, "yMax": hi}
                   for k, g, zh, en, u, c, lo, hi in SERIES_DEFS],
        "scalars": [{"key": k, "group": g, "label": zh, "labelEn": en, "unit": u,
                     "refMin": lo, "refMax": hi, "atEvent": ev, "hint": h}
                    for k, g, zh, en, u, _v, lo, hi, ev, h in SCALAR_DEFS],
    })

    # Two fully-populated pitches: enough to build the report and compare pages.
    detail_ids = [
        ("s_p_chen_20260824_p01", 0.0, 0.0),
        ("s_p_chen_20260824_p07", 0.6, 0.35),
        ("s_p_chen_20260819_p04", 1.3, -0.2),
    ]
    for pid, seed, jitter in detail_ids:
        base = next(p for rows in pitches_by_session.values() for p in rows if p["id"] == pid)
        write(f"pitch/{pid}.json", {
            **base,
            "media": {
                # 8 機位 slots — real capture is single-camera today, so every
                # slot points at the same placeholder clip until multi-rig
                # footage exists.
                "videoUrls": ["/media/sample-pitch.mp4"] * 8,
                "poseUrl": f"/api/pose/{pid}.json",
                "width": 1920, "height": 1080,
            },
            "scalars": build_scalars(jitter),
            "series": build_series(seed),
        })
        write(f"pose/{pid}.json", {
            "jointNames": JOINT_NAMES,
            "bones": BONES,
            "frames": pose_frames(),
        })

    print("\ndone.")


if __name__ == "__main__":
    main()
