-- XPORTS Pitch AI — MySQL 8.0 schema
--
-- Measurements are split into two tables that mirror the frontend contract in
-- src/api/types.ts:
--
--   pitch_series  線性資料 — one row per curve, samples held in a JSON column
--   pitch_scalars 單一值   — one row per metric per pitch
--
-- Curve payloads live in JSON columns rather than a row-per-frame table.
-- A 120-frame pitch with 24 curves would be ~2,900 rows per pitch in the
-- normalised form; the curves are always read whole and never queried by
-- individual frame, so JSON is both smaller and faster here. If you later need
-- to query across frames (e.g. "find every pitch whose elbow torque peaked
-- above X"), store that peak as a scalar rather than normalising the curve.

SET NAMES utf8mb4;

CREATE TABLE teams (
  id          CHAR(26)     NOT NULL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE users (
  id            CHAR(26)     NOT NULL PRIMARY KEY,
  team_id       CHAR(26)     NOT NULL,
  role          ENUM('coach','player') NOT NULL,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  player_id     CHAR(26)     NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_team FOREIGN KEY (team_id) REFERENCES teams(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE players (
  id          CHAR(26)     NOT NULL PRIMARY KEY,
  team_id     CHAR(26)     NOT NULL,
  name        VARCHAR(120) NOT NULL,
  avatar_url  VARCHAR(500) NULL,
  height_cm   SMALLINT     NULL,
  weight_kg   SMALLINT     NULL,
  throws      ENUM('L','R') NOT NULL,
  birth_date  DATE         NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_players_team FOREIGN KEY (team_id) REFERENCES teams(id),
  INDEX idx_players_team (team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE users
  ADD CONSTRAINT fk_users_player FOREIGN KEY (player_id) REFERENCES players(id);

-- A capture session, e.g. "8/24 牛棚投球".
CREATE TABLE sessions (
  id            CHAR(26)     NOT NULL PRIMARY KEY,
  player_id     CHAR(26)     NOT NULL,
  session_date  DATE         NOT NULL,
  label         VARCHAR(120) NOT NULL,
  status        ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_player FOREIGN KEY (player_id) REFERENCES players(id),
  INDEX idx_sessions_player_date (player_id, session_date DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE pitches (
  id            CHAR(26)     NOT NULL PRIMARY KEY,
  session_id    CHAR(26)     NOT NULL,
  pitch_number  SMALLINT     NOT NULL,
  pitch_type    VARCHAR(40)  NOT NULL DEFAULT '直球',
  velocity_kmh  DECIMAL(5,1) NULL,
  status        ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
  thrown_at     DATETIME     NOT NULL,
  frame_count   SMALLINT     NOT NULL,
  fps           SMALLINT     NOT NULL,
  starred       BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pitches_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE KEY uq_pitch_number (session_id, pitch_number),
  INDEX idx_pitches_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- FP / MER / BR, as frame indices into the clip.
CREATE TABLE pitch_events (
  pitch_id    CHAR(26) NOT NULL,
  event_key   ENUM('fps','fp','mer','br') NOT NULL,
  frame_index SMALLINT NOT NULL,
  PRIMARY KEY (pitch_id, event_key),
  CONSTRAINT fk_events_pitch FOREIGN KEY (pitch_id) REFERENCES pitches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE pitch_media (
  pitch_id   CHAR(26)     NOT NULL PRIMARY KEY,
  pose_url   VARCHAR(500) NULL,
  width      SMALLINT     NOT NULL DEFAULT 1920,
  height     SMALLINT     NOT NULL DEFAULT 1080,
  CONSTRAINT fk_media_pitch FOREIGN KEY (pitch_id) REFERENCES pitches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 機位 (camera rig) videos — one row per camera that has footage for a pitch.
-- A single-camera capture is just one row (camera_no 1); the frontend's
-- media.videoUrls is this set expanded to a fixed 8-slot array, null where a
-- camera has no row.
CREATE TABLE pitch_camera_video (
  pitch_id   CHAR(26)     NOT NULL,
  camera_no  TINYINT      NOT NULL, -- 1..8
  video_url  VARCHAR(500) NOT NULL,
  PRIMARY KEY (pitch_id, camera_no),
  CONSTRAINT fk_camera_video_pitch FOREIGN KEY (pitch_id) REFERENCES pitches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 線性資料: one row per curve. `samples` is a JSON array of length frame_count.
CREATE TABLE pitch_series (
  pitch_id    CHAR(26)    NOT NULL,
  series_key  VARCHAR(60) NOT NULL,
  group_key   VARCHAR(40) NOT NULL,
  unit        VARCHAR(16) NOT NULL,
  samples     JSON        NOT NULL,
  ref_lower   JSON        NULL,
  ref_upper   JSON        NULL,
  y_min       DECIMAL(8,2) NOT NULL,
  y_max       DECIMAL(8,2) NOT NULL,
  PRIMARY KEY (pitch_id, series_key),
  CONSTRAINT fk_series_pitch FOREIGN KEY (pitch_id) REFERENCES pitches(id) ON DELETE CASCADE,
  INDEX idx_series_group (pitch_id, group_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 單一值: one row per metric per pitch.
CREATE TABLE pitch_scalars (
  pitch_id    CHAR(26)     NOT NULL,
  scalar_key  VARCHAR(60)  NOT NULL,
  group_key   VARCHAR(40)  NOT NULL,
  unit        VARCHAR(16)  NOT NULL,
  value       DECIMAL(10,3) NULL,
  ref_min     DECIMAL(10,3) NOT NULL,
  ref_max     DECIMAL(10,3) NOT NULL,
  at_event    ENUM('fps','fp','mer','br') NULL,
  PRIMARY KEY (pitch_id, scalar_key),
  CONSTRAINT fk_scalars_pitch FOREIGN KEY (pitch_id) REFERENCES pitches(id) ON DELETE CASCADE,
  INDEX idx_scalars_group (pitch_id, group_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Labels and hints live here rather than being repeated on every pitch row.
-- Seeded once; the API joins them onto pitch_series / pitch_scalars.
CREATE TABLE measurement_defs (
  measurement_key VARCHAR(60) NOT NULL PRIMARY KEY,
  kind            ENUM('series','scalar') NOT NULL,
  group_key       VARCHAR(40)  NOT NULL,
  label_zh        VARCHAR(120) NOT NULL,
  label_en        VARCHAR(120) NOT NULL,
  unit            VARCHAR(16)  NOT NULL,
  color           VARCHAR(20)  NULL,
  hint_zh         TEXT         NULL,
  sort_order      SMALLINT     NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Saved comparisons (比較頁). Two pitches, optionally named.
CREATE TABLE comparisons (
  id          CHAR(26)  NOT NULL PRIMARY KEY,
  user_id     CHAR(26)  NOT NULL,
  pitch_a_id  CHAR(26)  NOT NULL,
  pitch_b_id  CHAR(26)  NOT NULL,
  label       VARCHAR(120) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cmp_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_cmp_a FOREIGN KEY (pitch_a_id) REFERENCES pitches(id) ON DELETE CASCADE,
  CONSTRAINT fk_cmp_b FOREIGN KEY (pitch_b_id) REFERENCES pitches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
