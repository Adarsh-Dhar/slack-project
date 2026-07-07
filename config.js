// config.js
// @ts-nocheck
import 'dotenv/config';

function requireEnv(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

export const config = {
  SLACK_BOT_TOKEN: requireEnv('SLACK_BOT_TOKEN'),
  SLACK_SIGNING_SECRET: process.env['SLACK_SIGNING_SECRET'] ?? '',
  SLACK_APP_TOKEN: process.env['SLACK_APP_TOKEN'] ?? '',
  PORT: parseInt(process.env['PORT'] ?? '3000', 10),
  DB_PATH: process.env['DB_PATH'] ?? './launchbot.db',

  // ─── Signal intake & demand validation ───────────────────────────────────
  // Maps Slack channel IDs to a source_type, so ingestion is one generic
  // listener instead of five hardcoded ones. Add a new source by adding a
  // channel here — no listener code changes needed.
  SIGNAL_SOURCE_CHANNELS: {
    [process.env['CHANNEL_SUPPORT_TICKETS'] ?? '']: 'support_ticket',
    [process.env['CHANNEL_SALES_FEEDBACK'] ?? '']: 'sales_feedback',
    [process.env['CHANNEL_USER_INTERVIEWS'] ?? '']: 'user_interview',
    [process.env['CHANNEL_ANALYTICS'] ?? '']: 'analytics',
    [process.env['CHANNEL_CHURN_ALERTS'] ?? '']: 'churn',
  },

  // Where validated/new clusters get posted for PM review. Falls back to
  // posting in the source channel if unset.
  SIGNAL_REVIEW_CHANNEL_ID: process.env['SIGNAL_REVIEW_CHANNEL_ID'] ?? '',

  // A cluster needs at least this many events before it's eligible to be
  // scored at all — below this, it's noise, not a candidate signal.
  SIGNAL_MIN_EVENTS_TO_CLUSTER: parseInt(process.env['SIGNAL_MIN_EVENTS_TO_CLUSTER'] ?? '2', 10),

  // Confidence score (0-1) cutoffs for labeling a cluster low/medium/high.
  SIGNAL_CONFIDENCE_THRESHOLDS: { high: 0.7, medium: 0.4 },

  // ─── Problem definition: competitive scan & opportunity sizing ──────────
  // Known competitor names to match against signal_events text for the
  // "mine your own data" pass. Add names here as you learn about them from
  // deals/churn — this list is expected to grow manually, not be inferred.
  KNOWN_COMPETITORS: (process.env['KNOWN_COMPETITORS'] ?? 'Vendor X').split(',').map(s => s.trim()).filter(Boolean),

  // Cap on web searches per competitive scan run — bounds cost and prevents
  // an unbounded research loop. Each search must still produce a cited URL
  // or the claim doesn't get recorded at all.
  COMPETITIVE_SCAN_MAX_SEARCHES: parseInt(process.env['COMPETITIVE_SCAN_MAX_SEARCHES'] ?? '5', 10),

  // Manually maintained segment population sizes, used ONLY to extrapolate
  // an opportunity's high-end estimate ("if this affects the same share of
  // the whole segment..."). There's no real usage-analytics integration
  // behind this — it's a config knob a PM updates periodically. If a
  // segment isn't listed here, sizing reports the low (observed) estimate
  // only and says so explicitly, rather than guessing a size.
  SEGMENT_SIZES: {
    free: parseInt(process.env['SEGMENT_SIZE_FREE'] ?? '0', 10) || null,
    pro: parseInt(process.env['SEGMENT_SIZE_PRO'] ?? '0', 10) || null,
    business: parseInt(process.env['SEGMENT_SIZE_BUSINESS'] ?? '0', 10) || null,
    enterprise: parseInt(process.env['SEGMENT_SIZE_ENTERPRISE'] ?? '0', 10) || null,
  },

  // Ceiling on the extrapolation multiplier (segmentSize / reachCount) so a
  // cluster with 1 confirmed account and a huge segment doesn't produce an
  // absurd high-end number.
  OPPORTUNITY_MAX_EXTRAPOLATION_MULTIPLIER: 20,
};
