// listeners/actions/slip-actions.js
// @ts-nocheck

export function register(app) {
  // ─── Slip: Yes, we slip ──────────────────────────────────────────────────
  app.action('slip_yes', async ({ ack }) => {
    await ack();
    // Future: could update launch date or notify PM here
  });

  // ─── Slip: No, we're fine ────────────────────────────────────────────────
  app.action('slip_no', async ({ ack }) => {
    await ack();
    // Future: could dismiss the alert or log the confirmation
  });

  // ─── Slip: Explain in thread ─────────────────────────────────────────────
  app.action('slip_explain', async ({ ack }) => {
    await ack();
    // User will respond in thread — no further action needed
  });
}
