// services/comms.js
//
// Fires outbound comms for a launch. Each `channel` maps to a webhook URL
// configured in config.js — swap the fetch calls for your actual
// CMS / email-service-provider / social-scheduler SDK as needed.
// @ts-nocheck

import * as db from '../db/index.js';
import { config } from '../config.js';

export async function triggerComms({ launchId, channel, message, triggeredBy }) {
  const webhookUrl = config.COMMS_WEBHOOKS[channel];
  if (!webhookUrl) {
    throw new Error(`No webhook configured for comms channel "${channel}". Set COMMS_WEBHOOK_${channel.toUpperCase()} in .env.`);
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
    db.logComms({ launchId, channel, status: 'sent', triggeredBy, detail: message });
  } catch (e) {
    db.logComms({ launchId, channel, status: 'failed', triggeredBy, detail: e.message });
    throw e;
  }
}
