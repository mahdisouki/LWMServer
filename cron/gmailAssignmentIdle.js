const cron = require('node-cron');
const { deactivateIdleAssignmentAdmins } = require('../services/gmailAssignmentService');

async function runIdleCheck() {
  try {
    await deactivateIdleAssignmentAdmins();
  } catch (error) {
    console.error('[Gmail Assignment Idle] Error:', error.message);
  }
}

// Every 15 minutes. The idle window itself is 30 minutes, so someone can stay
// active until the next check (about 30–45 minutes after their last activity).
cron.schedule('*/15 * * * *', runIdleCheck);

console.log('[Gmail Assignment Idle] Scheduler running (every 15 min, 30 min idle)');

module.exports = { runIdleCheck };
