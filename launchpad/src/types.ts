// src/types.ts

// ─── Database row shapes ────────────────────────────────────────────────────

export type LaunchStatus = 'active' | 'approved' | 'launched' | 'retro_pending' | 'archived' | 'cancelled';
export type LaunchPhase = 'discovery' | 'build' | 'prelaunch' | 'gonogo' | 'launchday';
export type ItemStatus = 'not_started' | 'in_progress' | 'done' | 'blocked';
export type TeamName = 'engineering' | 'marketing' | 'docs' | 'legal' | 'sales' | 'other';

// ─── Launch tier ─────────────────────────────────────────────────────────────
export type LaunchTier = 'major' | 'moderate' | 'minor';

// ─── Sub-channel descriptor ───────────────────────────────────────────────────
export interface SubChannel {
  suffix: string;          // e.g. 'eng', 'mktg', 'cs-readiness'
  team: TeamName;          // maps to TeamName for stakeholder tracking
  purpose: string;         // set as channel purpose/description
}

export interface LaunchRow {
  id: number;
  name: string;
  channel_id: string;
  launch_date: string;       // ISO date string e.g. "2025-07-15"
  pm_user_id: string;
  tier: LaunchTier;           // NEW
  canvas_id: string | null;
  status: LaunchStatus;
  retro_scheduled_for: string | null;
  retro_completed_at: string | null;
  outcome_summary: string | null;
  current_phase: LaunchPhase;
  created_at: string;
}

export interface ItemRow {
  id: number;
  launch_id: number;
  team: TeamName;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  status: ItemStatus;
  created_at: string;
}

export interface StakeholderChannelRow {
  id: number;
  launch_id: number;
  channel_id: string;
  team: TeamName;
}

export interface TeamRosterRow {
  id: number;
  launch_id: number;
  team: TeamName;
  usergroup_id: string | null;
  manual_user_ids: string | null;
}

// ─── Service input shapes ────────────────────────────────────────────────────

export interface CreateLaunchInput {
  name: string;
  channelId: string;
  launchDate: string;
  pmUserId: string;
  tier: LaunchTier;           // NEW
}

export interface CreateItemInput {
  launchId: number;
  team: TeamName;
  title: string;
  ownerId?: string | null;
  dueDate?: string | null;
  status?: ItemStatus;
}

export interface AddStakeholderChannelInput {
  launchId: number;
  channelId: string;
  team: TeamName;
}

// ─── Parsed command ──────────────────────────────────────────────────────────

export interface ParsedLaunchCommand {
  featureName: string;
  launchDate: string;        // ISO date
  tier: LaunchTier;           // NEW
  mentionedUsers: string[];  // Slack user IDs
  mentionedChannels: string[]; // Slack channel IDs
}

// ─── Canvas / checklist ──────────────────────────────────────────────────────

export interface DefaultChecklistItem {
  title: string;
  dueOffsetDays: number;   // negative = N days before launch
}

export type DefaultChecklist = Record<TeamName, DefaultChecklistItem[]>;

// ─── Scan results ────────────────────────────────────────────────────────────

export interface ChannelScanResult {
  messageCount: number;
  hasCompletion: boolean;
  hasSlip: boolean;
  latestMessage: string | null;
  latestTs: string | null;
}

export type ScanResultsByTeam = Partial<Record<TeamName, ChannelScanResult | null>>;

// ─── Block Kit helpers ───────────────────────────────────────────────────────

export interface StandupBlocksInput {
  itemTitle: string;
  launchName: string;
  launchDate: string;
  itemId: number;
  launchId: number;
}

export interface SlipAlertBlocksInput {
  detectedUserId: string;
  channelName: string;
  messageText: string;
  launchDate: string;
  launchId: number;
}

export interface GoNoGoBlocksInput {
  launch: LaunchRow;
  items: ItemRow[];
  completedCount: number;
  totalCount: number;
}

// ─── Retro / outcome ──────────────────────────────────────────────────────────

export interface OutcomeFormInput {
  launchId: number;
  whatWentWell: string;
  whatDidnt: string;
  adoptionNotes: string;
  submittedBy: string;
}
