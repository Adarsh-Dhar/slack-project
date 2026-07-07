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
  gonogo_decision     TEXT CHECK (gonogo_decision IN ('go', 'no_go', 'hold')),
  gonogo_decided_by   TEXT,
  gonogo_decided_at   TEXT,
  live_confirmed_at   TEXT,
  live_confirmed_by   TEXT,
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

-- Outbound comms triggered for a launch (announcement posts, blog, email, social).
-- Purely a log/audit trail — actual delivery happens via services/comms.js.
CREATE TABLE IF NOT EXISTS comms_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  launch_id    INTEGER NOT NULL REFERENCES launches(id),
  channel      TEXT NOT NULL CHECK (channel IN ('blog', 'email', 'social', 'press')),
  status       TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  triggered_by TEXT NOT NULL,
  detail       TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- Budget/resource tracking per launch. Mirrors the kpis table shape.
CREATE TABLE IF NOT EXISTS budget_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  launch_id       INTEGER NOT NULL REFERENCES launches(id),
  category        TEXT NOT NULL,
  approved_amount TEXT,
  spent_amount    TEXT,
  approver        TEXT,
  approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  updated_by      TEXT,
  updated_at      TEXT DEFAULT (datetime('now')),
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(launch_id, category)
);

-- Structured CS/support readiness items (FAQ docs, macros, escalation paths),
-- distinct from the generic checklist so they can carry a link + status.
CREATE TABLE IF NOT EXISTS cs_readiness_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  launch_id   INTEGER NOT NULL REFERENCES launches(id),
  item        TEXT NOT NULL,
  link        TEXT,
  status      TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'done')),
  updated_by  TEXT,
  updated_at  TEXT DEFAULT (datetime('now')),
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(launch_id, item)
);

-- Risk assessments per launch category.
CREATE TABLE IF NOT EXISTS risk_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  launch_id   INTEGER NOT NULL REFERENCES launches(id),
  category    TEXT NOT NULL CHECK (category IN ('technical', 'legal', 'market_timing', 'other')),
  level       TEXT NOT NULL DEFAULT 'medium' CHECK (level IN ('low', 'medium', 'high')),
  note        TEXT,
  updated_by  TEXT,
  updated_at  TEXT DEFAULT (datetime('now')),
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(launch_id, category)
);

-- Marketing/docs/sales copy review and approval.
CREATE TABLE IF NOT EXISTS content_reviews (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  launch_id    INTEGER NOT NULL REFERENCES launches(id),
  content_type TEXT NOT NULL CHECK (content_type IN ('marketing', 'docs', 'sales')),
  link         TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'changes_requested')),
  submitted_by TEXT NOT NULL,
  reviewer     TEXT,
  note         TEXT,
  updated_at   TEXT DEFAULT (datetime('now')),
  created_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(launch_id, content_type)
);

-- ─── Signal intake & demand validation ─────────────────────────────────────
-- NOTE: unlike every table above, these do NOT key off launch_id. Signals
-- exist to help decide whether a launch should exist in the first place —
-- they're pre-launch, product-wide. promoted_launch_id on signal_clusters
-- is nullable and only gets set later, if a PM turns a validated cluster
-- into an actual launch. Never require a launch to log a signal.

-- Raw, immutable ingestion. One row per ticket / deal note / interview
-- excerpt / analytics alert / churn reason. Never edited after insert —
-- if extraction was wrong, fix it in the next row, don't mutate history.
CREATE TABLE IF NOT EXISTS signal_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type   TEXT NOT NULL CHECK (source_type IN ('support_ticket', 'sales_feedback', 'user_interview', 'analytics', 'churn')),
  channel_id    TEXT,
  message_ts    TEXT,
  account_ref   TEXT,     -- best-effort extracted customer/account/user id, nullable
  segment       TEXT,     -- best-effort extracted plan tier / company size, nullable
  revenue_hint  REAL,     -- best-effort extracted dollar amount mentioned, nullable
  raw_text      TEXT NOT NULL,
  cluster_id    INTEGER REFERENCES signal_clusters(id),  -- null until clustered
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Derived analysis: a group of signal_events believed to describe the same
-- underlying problem, plus a computed confidence score. Fully re-derivable
-- from signal_events at any time — safe to recompute, never a source of truth.
CREATE TABLE IF NOT EXISTS signal_clusters (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_summary    TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'validated', 'dismissed', 'promoted')),
  reach_count        INTEGER NOT NULL DEFAULT 0,   -- distinct accounts affected
  source_diversity   INTEGER NOT NULL DEFAULT 0,   -- distinct source_types represented
  revenue_exposure   REAL NOT NULL DEFAULT 0,      -- summed revenue_hint across members
  confidence_score   REAL,                          -- 0.0-1.0, null until validated
  confidence_label   TEXT CHECK (confidence_label IN ('low', 'medium', 'high')),
  promoted_launch_id INTEGER REFERENCES launches(id),  -- set only if/when promoted to a launch
  updated_at         TEXT DEFAULT (datetime('now')),
  created_at         TEXT DEFAULT (datetime('now'))
);

-- ─── Problem definition artifacts ──────────────────────────────────────────
-- All three key off cluster_id, same as signal_events/signal_clusters — this
-- is the "definition" phase of the lifecycle sitting on the same evidence
-- trail as intake and validation. Nothing here requires a launch to exist yet.

-- Versioned so a PM's edit doesn't destroy the agent's draft — each edit is
-- a new row, never an overwrite, matching the audit-trail pattern used
-- everywhere else in this schema (cost_events, revenue_events, etc.).
CREATE TABLE IF NOT EXISTS problem_statements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id   INTEGER NOT NULL REFERENCES signal_clusters(id),
  version      INTEGER NOT NULL DEFAULT 1,
  draft_text   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  created_by   TEXT NOT NULL,   -- 'agent' or a Slack user ID
  created_at   TEXT DEFAULT (datetime('now'))
);

-- One row per competitor claim, not a paragraph — a PM can approve/dispute
-- a single row without having to fact-check a whole write-up.
CREATE TABLE IF NOT EXISTS competitive_scans (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id        INTEGER NOT NULL REFERENCES signal_clusters(id),
  competitor_name   TEXT NOT NULL,
  capability_status TEXT NOT NULL CHECK (capability_status IN ('has_it', 'lacks_it', 'unknown')),
  evidence_type     TEXT NOT NULL CHECK (evidence_type IN ('own_data', 'web_search')),
  source_ref        TEXT,   -- deal ID for own_data, URL for web_search — null only if evidence_type='own_data' has no single deal to point to
  note              TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);

-- Opportunity size is deliberately a RANGE with a stated method, never a
-- single number — see the note in services/opportunitySizing.js. One row
-- per estimate run, so re-running as more evidence arrives doesn't erase
-- the earlier, more conservative estimate.
CREATE TABLE IF NOT EXISTS opportunity_sizes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id        INTEGER NOT NULL REFERENCES signal_clusters(id),
  low_estimate      REAL NOT NULL,   -- observed only: confirmed revenue_exposure from linked events
  high_estimate     REAL,             -- extrapolated across segment, null if segment size unknown
  basis_note        TEXT NOT NULL,   -- human-readable explanation of the method used
  created_at        TEXT DEFAULT (datetime('now'))
);
