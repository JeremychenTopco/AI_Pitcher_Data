# OpenBiomechanics demo data

`pitch/obp_<trial>.json` and `pose/obp_<trial>.json` are derived from **real
pitching trials** of the **OpenBiomechanics Project** by Driveline Baseball.
Each demo player (`p_obp_<user>`) is one real athlete (metadata.csv's `user`
column — stable across their trials); their session (`s_obp_<session>`) holds
every trial of theirs that's wired in, so an athlete with several pitches
shows up as one player with a multi-pitch session, not several look-alike
players. Handedness / height / weight also come from `metadata.csv`.

The dataset is anonymized (no real names), and "OBP 示範投手 `<user id>`" —
this notice's own original placeholder — read as unfinished/debug text
rather than a name once it was actually sitting in the roster next to 陳OO /
林OO / 王OO. Each OBP player now gets a surname the same way (`SURNAME_FOR`
in `scripts/obp_to_fixture.mjs`), so they look like any other roster entry:

| player (user id) | throws | session | pitches (mph) |
|---|---|---|---|
| 洪OO (750) | R | 1031 | `1031_2` (90.4) |
| 邱OO (1543) | L | 3053 | `3053_1` (81.4) |
| 曾OO (970) | R | 1623 | `1623_3` (85.3) |
| 楊OO (986) | R | 1668 | `1668_1` (87.9) |
| 許OO (1596) | R | 2916 | `2916_4` (94.4) |
| 鄭OO (922) | L | 1717 | `1717_1` (72.0) |
| 謝OO (1633) | R | 2891 | `2891_1..5` (87.3, 87.2, 86.9, 87.9, 87.9) |
| 賴OO (1000) | L | 1718 | `1718_1..3` (91.2, 90.8, 90.8) |
| 呂OO (906) | L | 1371 | `1371_2..3` (87.4, 87.8) |
| 蔡OO (822) | R | 2969 | `2969_1..3` (90.4, 89.8, 88.6) |
| 吳OO (964) | R | 3037 | `3037_1..5` (89.5, 88.7, 88.9, 88.8, 88.6) |
| 黃OO (1689) | R | 3046 | `3046_1..4` (82.1, 81.9, 81.7, 82.3) |

28 real trials across 12 players. Player *ids* still carry the user number
(`p_obp_750`, etc. — internal, never shown) and session ids still carry the
session number (`s_obp_1031`, etc.) — only the displayed `name` changed, from
an earlier "OBP 示範投手 `<id>`" scheme. Wiring in another OBP athlete later
means adding their user id to `SURNAME_FOR` with an unused surname; left out,
they fall back to that old placeholder-style label.

- Source: https://github.com/drivelineresearch/openbiomechanics (release `dataset-v1`)
- Converter: `scripts/obp_to_fixture.mjs` — `node scripts/obp_to_fixture.mjs <scratchDir> <trial> [trial...]`
  (reads `joint_angles.csv`, `joint_velos.csv`, `landmarks.csv`, `poi_metrics.csv`,
  `metadata.csv` from `<scratchDir>`; processes any number of trials in one pass)
- What was used: `joint_angles.csv` (curves + event times), `joint_velos.csv`
  (the pipeline's own angular-velocity signal — falls back to numerically
  differentiating the angle curve if this file isn't present), `landmarks.csv`
  (3D joint centres → skeleton), `poi_metrics.csv` (scalar metrics), `metadata.csv`
  (height/weight/age → the demo player record).
- Processing: windowed to foot-contact → release, resampled to 120 frames.
  **Played back at a fixed 20 fps** (matching every other fixture in this app)
  rather than the real capture rate — a real delivery is ~0.3s, and reviewing
  it at that true speed is a blur; slowing it to a fixed, watchable rate is
  standard practice for biomechanics review. Only frame *positions* (event
  timing, curve shape) come from the real capture — not the playback speed
  itself. The 2D skeleton uses one fixed camera framing for the whole clip
  (computed from the trial's full bounding box), not a per-frame auto-fit —
  a real camera doesn't zoom, so neither should this.
- **Not yet used, but available in the same release** for a richer 動力鍊
  (kinetic-chain) view: `pitching_energy_flow.zip` (real per-frame joint
  power / energy transfer — proximal→distal sequencing, not just 4 generic
  angular velocities) and `pitching_forces_moments.zip` (real per-frame joint
  torques/moments — kinetics, not just kinematics). Ask if you want these wired
  into a new chart group.

## Licence — read before shipping

The OBP **data** is licensed **CC BY-NC-SA 4.0** with an added restriction:

> Any employee or contractor of a professional sports organization is forbidden
> to use The OpenBiomechanics Project data for any use whatsoever (without a paid
> commercial licence).

Practical implications for this repo:

- **Non-commercial only.** Do not bundle these files in a commercial release of
  XPORTS Pitch AI without a commercial licence from Driveline.
- **ShareAlike.** Any distributed derivative must also be CC BY-NC-SA 4.0.
- **Attribution** required (this notice).

For a shipped product, replace these with your own captured data or a licensed set.
The OBP code (and this converter) is MIT.
