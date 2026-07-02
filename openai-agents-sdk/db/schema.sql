CREATE TABLE IF NOT EXISTS launches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  channel_id  TEXT NOT NULL UNIQUE,
  launch_date TEXT NOT NULL,
  pm_user_id  TEXT NOT NULL,
  tier        TEXT DEFAULT 'moderate',
  canvas_id   TEXT,
  github_repo TEXT,
  status      TEXT DEFAULT 'active',
  current_phase TEXT DEFAULT 'discovery',
  retro_scheduled_for TEXT,        -- ISO date, set when retro prompt is posted
  retro_completed_at  TEXT,        -- ISO datetime, set when PM submits outcome
  outcome_summary     TEXT,        -- free text the PM fills in
  gonogo_posted_for   TEXT,        -- ISO date, set when the Go/No-Go canvas is posted (prevents re-posting same day)
  gonogo_message_ts   TEXT,        -- ts of the canvas message, so we can chat.update it as responses come in
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  launch_id   INTEGER NOT NULL REFERENCES launches(id),
  team        TEXT NOT NULL,
  title       TEXT NOT NULL,
  owner_id    TEXT,
  due_date    TEXT,
  status      TEXT DEFAULT 'not_started',
  last_notified_at TEXT,
  notify_count      INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stakeholder_channels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  launch_id   INTEGER NOT NULL REFERENCES launches(id),
  channel_id  TEXT NOT NULL,
  team        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_rosters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  launch_id   INTEGER NOT NULL REFERENCES launches(id),
  team        TEXT NOT NULL,
  usergroup_id TEXT,
  manual_user_ids TEXT,
  UNIQUE(launch_id, team)
);

CREATE TABLE IF NOT EXISTS gonogo_responses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  launch_id     INTEGER NOT NULL REFERENCES launches(id),
  item_id       INTEGER NOT NULL REFERENCES items(id),
  status        TEXT NOT NULL CHECK (status IN ('green', 'red')),
  responded_by  TEXT NOT NULL,
  responded_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(item_id)
);

CREATE TABLE IF NOT EXISTS gonogo_overrides (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  launch_id     INTEGER NOT NULL REFERENCES launches(id),
  item_id       INTEGER NOT NULL REFERENCES items(id),
  requested_by  TEXT NOT NULL,
  reason        TEXT,
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  resolved_by   TEXT,
  resolved_at   TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notified_deadlines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  launch_id     INTEGER NOT NULL REFERENCES launches(id),
  deadline_key  TEXT NOT NULL,
  notified_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(launch_id, deadline_key)
);

CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  launch_id   INTEGER NOT NULL REFERENCES launches(id),
  user_id     TEXT NOT NULL,
  sentiment   TEXT CHECK (sentiment IN ('went_well', 'went_wrong')),
  text        TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Resolutions for slip alerts raised by services/slipDetector.js. Previously
-- the Yes/No/Explain buttons only called ack() with no persistence or
-- follow-up action (see listeners/actions/slip-actions.js).
CREATE TABLE IF NOT EXISTS slip_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  launch_id     INTEGER NOT NULL REFERENCES launches(id),
  channel_id    TEXT NOT NULL,
  detected_user_id TEXT NOT NULL,
  message_text  TEXT,
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'dismissed', 'explaining')),
  resolved_by   TEXT,
  resolved_at   TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Success metrics / KPIs a PM wants tracked for a launch, so status and
-- leadership reports can include more than checklist completion.
CREATE TABLE IF NOT EXISTS kpis (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  launch_id     INTEGER NOT NULL REFERENCES launches(id),
  name          TEXT NOT NULL,
  target_value  TEXT,
  current_value TEXT,
  unit          TEXT,
  updated_by    TEXT,
  updated_at    TEXT DEFAULT (datetime('now')),
  created_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(launch_id, name)
);
