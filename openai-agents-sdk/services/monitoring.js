// services/monitoring.js
//
// On-demand read of live metrics/error rates from your monitoring provider.
// Swap the fetch call for your actual Datadog/Sentry/etc. API.
// @ts-nocheck

import { config } from '../config.js';

export async function getLiveMetrics(launchName) {
  if (!config.MONITORING_API_URL) {
    throw new Error('MONITORING_API_URL is not configured. Set it in .env to enable live metrics.');
  }
  const res = await fetch(
    `${config.MONITORING_API_URL}/metrics?feature=${encodeURIComponent(launchName)}`,
    { headers: { Authorization: `Bearer ${config.MONITORING_API_KEY}` } }
  );
  if (!res.ok) throw new Error(`Monitoring API responded ${res.status}`);
  return res.json();
}
