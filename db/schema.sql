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

