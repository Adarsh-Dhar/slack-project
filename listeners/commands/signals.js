// listeners/commands/signals.js
// @ts-nocheck
//
// /signals cluster            -> run clustering + scoring over pending events, post results
// /signals list [status]      -> list clusters (default: all)
// /signals show <id>          -> show one cluster with its evidence
// /signals dismiss <id>       -> mark a cluster as dismissed (loud minority, not worth pursuing)
// /signals validate <id>      -> mark a cluster as validated (worth a PM's next step)
//
// Not scoped to a launch channel — same reasoning as /launch-portfolio.
// This is where signals live BEFORE a launch exists, so there's no launch
// channel to scope it to yet.

import { config } from '../../config.js';
import * as db from '../../db/index.js';
import { clusterPendingSignals } from '../../services/signalClustering.js';
import { scoreCluster } from '../../services/demandValidation.js';
import { draftProblemStatement } from '../../services/problemStatement.js';
import { runCompetitiveScan } from '../../services/competitiveScan.js';
import { sizeOpportunity } from '../../services/opportunitySizing.js';

function fmtMoney(amount) {
  return `$${Number(amount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function confidenceEmoji(label) {
  return label === 'high' ? '🟢' : label === 'medium' ? '🟡' : '⚪';
}

function buildClusterSummaryBlocks(cluster) {
  return [{
    type: 'section',
    text: {
      type: 'mrkdwn',
      text:
        `${confidenceEmoji(cluster.confidence_label)} *#${cluster.id} — ${cluster.problem_summary}*\n` +
        `Reach: ${cluster.reach_count} account(s) • Sources: ${cluster.source_diversity} • ` +
        `Revenue exposure: ${fmtMoney(cluster.revenue_exposure)} • ` +
        `Confidence: ${cluster.confidence_score ?? '—'} (${cluster.confidence_label ?? 'unscored'}) • ` +
        `Status: ${cluster.status}`,
    },
  }];
}

function buildScanBlocks(rows) {
  if (rows.length === 0) {
    return [{ type: 'section', text: { type: 'mrkdwn', text: '_No competitor mentions found in own data, and no web search evidence recorded._' } }];
  }
  const lines = rows.map(r => {
    const statusEmoji = r.capability_status === 'has_it' ? '✅' : r.capability_status === 'lacks_it' ? '❌' : '❔';
    const evidenceTag = r.evidence_type === 'own_data' ? `own data, ref ${r.source_ref}` : (r.source_ref ? `web: ${r.source_ref}` : 'no citation found');
    return `${statusEmoji} *${r.competitor_name}* — ${r.capability_status} (${evidenceTag})${r.note ? `\n   _${r.note}_` : ''}`;
  });
  return [{ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }];
}

export function register(app) {
  app.command('/signals', async ({ command, ack, respond }) => {
    await ack();

    const [subcommand, arg] = command.text.trim().split(/\s+/);

    try {
      if (subcommand === 'cluster' || !subcommand) {
        const newClusterIds = clusterPendingSignals();
        if (newClusterIds.length === 0) {
          await respond('No new clusters met the minimum evidence threshold — nothing to review yet.');
          return;
        }
        const blocks = newClusterIds.flatMap(id => buildClusterSummaryBlocks(db.getSignalCluster(id)));
        const targetChannel = config.SIGNAL_REVIEW_CHANNEL_ID || command.channel_id;
        await app.client.chat.postMessage({
          channel: targetChannel,
          text: `${newClusterIds.length} new signal cluster(s) formed`,
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*${newClusterIds.length} new signal cluster(s):*` } }, ...blocks],
        });
        if (targetChannel !== command.channel_id) {
          await respond(`Posted ${newClusterIds.length} new cluster(s) to <#${targetChannel}>.`);
        }
        return;
      }

      if (subcommand === 'list') {
        const status = ['new', 'validated', 'dismissed', 'promoted'].includes(arg) ? arg : undefined;
        const clusters = db.getAllSignalClusters(status);
        if (clusters.length === 0) {
          await respond(status ? `No clusters with status "${status}".` : 'No clusters yet — run /signals cluster first.');
          return;
        }
        await respond({ text: `Signal clusters${status ? ` (${status})` : ''}`, blocks: clusters.flatMap(buildClusterSummaryBlocks) });
        return;
      }

      if (subcommand === 'show') {
        const clusterId = parseInt(arg, 10);
        const cluster = db.getSignalCluster(clusterId);
        if (!cluster) { await respond(`No cluster #${arg}.`); return; }
        const events = db.getSignalEventsForCluster(clusterId);
        const evidenceLines = events.map(e =>
          `• [${e.source_type}]${e.account_ref ? ` (${e.account_ref})` : ''}: ${e.raw_text.slice(0, 140)}${e.raw_text.length > 140 ? '…' : ''}`
        );
        await respond({
          text: `Cluster #${clusterId}`,
          blocks: [...buildClusterSummaryBlocks(cluster), { type: 'section', text: { type: 'mrkdwn', text: `*Evidence:*\n${evidenceLines.join('\n')}` } }],
        });
        return;
      }

      if (subcommand === 'validate' || subcommand === 'dismiss') {
        const clusterId = parseInt(arg, 10);
        const cluster = db.getSignalCluster(clusterId);
        if (!cluster) { await respond(`No cluster #${arg}.`); return; }
        db.updateClusterStatus(clusterId, subcommand === 'validate' ? 'validated' : 'dismissed');
        await respond(`Cluster #${clusterId} marked as ${subcommand === 'validate' ? 'validated' : 'dismissed'}.`);
        return;
      }

      if (subcommand === 'statement') {
        const clusterId = parseInt(arg, 10);
        const cluster = db.getSignalCluster(clusterId);
        if (!cluster) { await respond(`No cluster #${arg}.`); return; }
        const { draftText, version } = draftProblemStatement(clusterId, command.user_id);
        await respond({
          text: `Problem statement draft for cluster #${clusterId}`,
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*Problem statement — v${version} (draft)*\n\n${draftText}` } }],
        });
        return;
      }

      if (subcommand === 'scan') {
        const clusterId = parseInt(arg, 10);
        const cluster = db.getSignalCluster(clusterId);
        if (!cluster) { await respond(`No cluster #${arg}.`); return; }
        await respond(`Running competitive scan for cluster #${clusterId} — own data first, then a bounded web search…`);
        const rows = await runCompetitiveScan(clusterId, cluster.problem_summary.slice(0, 60));
        await respond({ text: `Competitive scan — cluster #${clusterId}`, blocks: buildScanBlocks(rows) });
        return;
      }

      if (subcommand === 'size') {
        const clusterId = parseInt(arg, 10);
        const cluster = db.getSignalCluster(clusterId);
        if (!cluster) { await respond(`No cluster #${arg}.`); return; }
        const { lowEstimate, highEstimate, basisNote } = sizeOpportunity(clusterId);
        await respond({
          text: `Opportunity size — cluster #${clusterId}`,
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text:
                `*Opportunity size — cluster #${clusterId}*\n` +
                `Low (observed): ${fmtMoney(lowEstimate)}\n` +
                `High (extrapolated): ${highEstimate != null ? fmtMoney(highEstimate) : 'not available'}\n\n` +
                `_${basisNote}_`,
            },
          }],
        });
        return;
      }

      if (subcommand === 'brief') {
        const clusterId = parseInt(arg, 10);
        const cluster = db.getSignalCluster(clusterId);
        if (!cluster) { await respond(`No cluster #${arg}.`); return; }
        await respond(`Building the problem brief for cluster #${clusterId}…`);

        const { draftText, version } = draftProblemStatement(clusterId, command.user_id);
        const scanRows = await runCompetitiveScan(clusterId, cluster.problem_summary.slice(0, 60));
        const { lowEstimate, highEstimate, basisNote } = sizeOpportunity(clusterId);

        await respond({
          text: `Problem brief — cluster #${clusterId}`,
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: `Problem Brief — Cluster #${clusterId}` } },
            { type: 'section', text: { type: 'mrkdwn', text: `*1. Problem statement (v${version}, draft)*\n${draftText}` } },
            { type: 'divider' },
            { type: 'section', text: { type: 'mrkdwn', text: '*2. Competitive scan*' } },
            ...buildScanBlocks(scanRows),
            { type: 'divider' },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  `*3. Opportunity size*\nLow (observed): ${fmtMoney(lowEstimate)} • ` +
                  `High (extrapolated): ${highEstimate != null ? fmtMoney(highEstimate) : 'not available'}\n_${basisNote}_`,
              },
            },
          ],
        });
        return;
      }

      await respond(
        'Usage: /signals cluster | /signals list [status] | /signals show <id> | /signals validate <id> | ' +
        '/signals dismiss <id> | /signals statement <id> | /signals scan <id> | /signals size <id> | /signals brief <id>'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[/signals] Error:', message);
      await respond(`❌ Error: ${message}`);
    }
  });
}
