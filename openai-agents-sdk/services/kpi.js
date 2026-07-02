// services/kpi.js
//
// Lightweight success-metric tracking. A PM defines a KPI once (name +
// optional target/unit) and updates its current value as data comes in;
// values surface in /launch-report and /launch-portfolio. Fills the
// "Success metrics/KPI tracking" gap — previously not built at all.
// @ts-nocheck

import * as db from '../db/index.js';

/**
 * Parses `/launch-kpi set "Activation rate" target:60 unit:%`
 * or       `/launch-kpi update "Activation rate" 42`
 * or       `/launch-kpi list`
 */
export function parseKpiCommand(text) {
  const trimmed = (text ?? '').trim();
  if (trimmed === '' || /^list$/i.test(trimmed)) {
    return { action: 'list' };
  }

  const setMatch = trimmed.match(/^set\s+"([^"]+)"(.*)$/i);
  if (setMatch) {
    const name = setMatch[1];
    const rest = setMatch[2];
    const targetMatch = rest.match(/target:(\S+)/i);
    const unitMatch = rest.match(/unit:(\S+)/i);
    return {
      action: 'set',
      name,
      targetValue: targetMatch ? targetMatch[1] : null,
      unit: unitMatch ? unitMatch[1] : null,
    };
  }

  const updateMatch = trimmed.match(/^update\s+"([^"]+)"\s+(\S+)/i);
  if (updateMatch) {
    return { action: 'update', name: updateMatch[1], currentValue: updateMatch[2] };
  }

  throw new Error(
    'Usage:\n' +
      '`/launch-kpi set "Name" target:60 unit:%`\n' +
      '`/launch-kpi update "Name" 42`\n' +
      '`/launch-kpi list`'
  );
}

export function defineKpi({ launchId, name, targetValue, unit, updatedBy }) {
  db.upsertKpi({ launchId, name, targetValue, unit, updatedBy });
}

export function updateKpiValue({ launchId, name, currentValue, updatedBy }) {
  const existing = db.getKpisForLaunch(launchId).find(k => k.name === name);
  if (!existing) {
    throw new Error(`No KPI named "${name}" on this launch yet. Define it first with \`/launch-kpi set\`.`);
  }
  db.recordKpiValue({ launchId, name, currentValue, updatedBy });
}

export function buildKpiListBlocks(launchId, launchName) {
  const kpis = db.getKpisForLaunch(launchId);
  if (kpis.length === 0) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `No success metrics defined for *${launchName}* yet. Add one with \`/launch-kpi set "Name" target:60 unit:%\`.`,
        },
      },
    ];
  }

  const lines = kpis
    .map(k => `• *${k.name}:* ${k.current_value ?? '—'} / ${k.target_value ?? 'no target'}${k.unit ? ` ${k.unit}` : ''}`)
    .join('\n');

  return [
    { type: 'section', text: { type: 'mrkdwn', text: `*Success metrics — ${launchName}*\n${lines}` } },
  ];
}
