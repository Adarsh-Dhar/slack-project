// services/report.js
//
// Compiles a leadership-ready status report for a single launch (or, via
// buildPortfolioBlocks, all active launches). Fills the "Report outcomes to
// leadership" and "Cross-launch reporting" gaps: previously outcome data was
// saved in the DB with no summary/export surface.
// @ts-nocheck

import * as db from '../db/index.js';
import { aggregateFeedback } from './feedback.js';

const PHASE_LABEL = {
  discovery: 'Discovery',
  build: 'Build',
  prelaunch: 'Pre-launch',
  gonogo: 'Go/No-Go',
  launchday: 'Launch Day',
};

function pct(done, total) {
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

/**
 * Gathers everything needed for a single-launch leadership report:
 * phase, checklist completion, red items, open slip risk, KPI progress,
 * and feedback sentiment so far.
 */
export function buildLaunchReport(launchId) {
  const launch = db.getLaunchById(launchId);
  if (!launch) return null;

  const items = db.getItemsByLaunch(launchId);
  const doneItems = items.filter(i => i.status === 'done');
  const redResponses = db.getGoNoGoResponses(launchId).filter(r => r.status === 'red');
  const openSlips = db.getOpenSlipEventCount(launchId);
  const kpis = db.getKpisForLaunch(launchId);
  const { wentWell, wentWrong } = aggregateFeedback(launchId);

  return {
    launch,
    items,
    doneItems,
    completionPct: pct(doneItems.length, items.length),
    redResponses,
    openSlips,
    kpis,
    wentWell,
    wentWrong,
  };
}

export function buildLaunchReportBlocks(report) {
  const { launch, items, doneItems, completionPct, redResponses, openSlips, kpis, wentWell, wentWrong } = report;
  const phaseLabel = PHASE_LABEL[launch.current_phase] ?? launch.current_phase;
  const health = redResponses.length > 0 || openSlips > 0 ? '🔴' : completionPct < 100 ? '🟡' : '🟢';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${health} Status Report — ${launch.name}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Launch date:*\n${launch.launch_date}` },
        { type: 'mrkdwn', text: `*Phase:*\n${phaseLabel}` },
        { type: 'mrkdwn', text: `*Tier:*\n${launch.tier}` },
        { type: 'mrkdwn', text: `*PM:*\n<@${launch.pm_user_id}>` },
        { type: 'mrkdwn', text: `*Checklist:*\n${doneItems.length}/${items.length} done (${completionPct}%)` },
        { type: 'mrkdwn', text: `*Open risk:*\n${redResponses.length} red item(s), ${openSlips} unresolved slip flag(s)` },
      ],
    },
  ];

  if (kpis.length > 0) {
    const kpiText = kpis
      .map(k => `• *${k.name}:* ${k.current_value ?? '—'} / ${k.target_value ?? 'no target'}${k.unit ? ` ${k.unit}` : ''}`)
      .join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Success metrics*\n${kpiText}` } });
  }

  if (wentWell || wentWrong) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Feedback so far*\n` +
          (wentWell ? `👍 ${wentWell}\n` : '') +
          (wentWrong ? `👎 ${wentWrong}` : ''),
      },
    });
  }

  if (launch.status === 'archived' && launch.outcome_summary) {
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Final retro outcome*\n${launch.outcome_summary}` } });
  }

  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Generated ${new Date().toISOString().slice(0, 10)}` }] });

  return blocks;
}

/**
 * Cross-launch snapshot for /launch-portfolio: one line per active launch
 * with phase, completion, and risk flags, sorted by launch date.
 */
export function buildPortfolioBlocks() {
  const rows = db.getPortfolioSnapshot();

  if (rows.length === 0) {
    return [{ type: 'section', text: { type: 'mrkdwn', text: 'No active launches right now.' } }];
  }

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '📊 Launch Portfolio', emoji: true } },
  ];

  for (const r of rows) {
    const phaseLabel = PHASE_LABEL[r.current_phase] ?? r.current_phase;
    const completion = pct(r.done_items, r.total_items);
    const health = r.red_items > 0 || r.open_slips > 0 ? '🔴' : completion < 100 ? '🟡' : '🟢';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `${health} *<#${r.channel_id}|${r.name}>* — ${r.launch_date} · ${phaseLabel} · ${r.tier}\n` +
          `${r.done_items}/${r.total_items} items done (${completion}%)` +
          (r.red_items > 0 ? ` · ${r.red_items} red` : '') +
          (r.open_slips > 0 ? ` · ${r.open_slips} slip flag(s)` : '') +
          ` · PM <@${r.pm_user_id}>`,
      },
    });
  }

  return blocks;
}
