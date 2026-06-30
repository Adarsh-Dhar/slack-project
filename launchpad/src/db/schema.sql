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
  gonogo_message_ts       TEXT,    -- Slack message ts of the posted checklist, so we can chat.update it
  gonogo_posted_at        TEXT,    -- ISO datetime, set once the T-48h checklist is posted (throttle)
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
  gonogo_response            TEXT,    -- 'green' | 'red' | 'overridden' | NULL
  gonogo_note                TEXT,    -- reason given when marked red
  gonogo_responded_at        TEXT,    -- ISO datetime of the green/red click
  gonogo_override_requested  INTEGER DEFAULT 0,
  gonogo_overridden_by       TEXT,    -- Slack user id of the PM who approved the override
  gonogo_overridden_at       TEXT,
  gonogo_last_nudged_at      TEXT,    -- ISO datetime, throttles red-item reminder DMs
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
