CREATE TABLE IF NOT EXISTS launches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  channel_id  TEXT NOT NULL UNIQUE,
  launch_date TEXT NOT NULL,
  pm_user_id  TEXT NOT NULL,
  tier        TEXT DEFAULT 'moderate',
  canvas_id   TEXT,
  status      TEXT DEFAULT 'active',
  retro_scheduled_for TEXT,        -- ISO date, set when retro prompt is posted
  retro_completed_at  TEXT,        -- ISO datetime, set when PM submits outcome
  outcome_summary     TEXT,        -- free text the PM fills in
  github_repo             TEXT,    -- "org/repo", optional, used for PR slip checks
  legal_signoff_required  INTEGER DEFAULT 0,  -- 1 for major-tier launches
  legal_signed_off_at     TEXT,    -- ISO datetime, set when legal approves
  last_pr_alert_at        TEXT,    -- ISO datetime, throttles open-PR alerts
  last_legal_escalated_at TEXT,    -- ISO datetime, throttles legal SLA nudges
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
  last_dm_sent_at    TEXT,  -- ISO datetime, set whenever a standup DM goes out
  last_dm_acked_at   TEXT,  -- ISO datetime, set when the owner clicks any standup button
  last_escalated_at  TEXT,  -- ISO datetime, throttles 24h no-reply nudges
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
