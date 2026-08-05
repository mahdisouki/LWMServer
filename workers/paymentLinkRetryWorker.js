const { processDuePaymentLinkEmails } = require('../services/failedPaymentLinkService');

// Poll every 1 minute while testing short delays; raise again for prod (e.g. 5 min with a 45 min delay).
const POLL_INTERVAL_MS = 1 * 60 * 1000;

let isRunning = false;

async function tick() {
  if (isRunning) return;
  isRunning = true;

  try {
    await processDuePaymentLinkEmails();
  } catch (error) {
    console.error('[Payment Link Retry Worker] Error:', error.message);
  } finally {
    isRunning = false;
  }
}

setInterval(tick, POLL_INTERVAL_MS);
setTimeout(tick, 15 * 1000);

console.log(
  `[Payment Link Retry Worker] Running (every ${POLL_INTERVAL_MS / 1000}s)`,
);

module.exports = { tick };
