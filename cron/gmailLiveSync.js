const Admin = require('../models/Admin');
const { pollNewMessagesWithClassification } = require('../services/gmailInboxSync');
const { emitToUser, isUserOnline } = require('../socket');

const POLL_INTERVAL_MS = 10 * 1000; // 10 seconds

let isRunning = false;

async function pollAllAdmins() {
  if (isRunning) return;
  isRunning = true;

  try {
    const admins = await Admin.find({
      'gmailTokens.access_token': { $exists: true, $ne: null },
    }).select('_id');

    for (const admin of admins) {
      const adminId = admin._id.toString();

      try {
        const { newMessages } = await pollNewMessagesWithClassification(adminId);

        if (!newMessages || newMessages.length === 0) continue;

        const socketOnline = isUserOnline(adminId);
        if (!socketOnline) {
          console.log(
            `[Gmail Live Sync] Admin ${adminId}: ${newMessages.length} new message(s) but socket offline`
          );
          continue;
        }

        for (const newMessage of newMessages) {
          emitToUser(adminId, 'gmail:new', newMessage);
        }
        const sent = emitToUser(adminId, 'gmail:inbox-updated', {
          count: newMessages.length,
          messageIds: newMessages.map((m) => m.id),
        });
        console.log(
          `[Gmail Live Sync] Admin ${adminId}: emitted ${newMessages.length} new message(s), sent=${sent}`
        );
      } catch (error) {
        console.warn(
          `[Gmail Live Sync] Poll failed for admin ${adminId}:`,
          error.message
        );
      }
    }
  } catch (error) {
    console.error('[Gmail Live Sync] Scheduler error:', error.message);
  } finally {
    isRunning = false;
  }
}

setInterval(pollAllAdmins, POLL_INTERVAL_MS);

console.log(
  `[Gmail Live Sync] Scheduler running (every ${POLL_INTERVAL_MS / 1000}s)`
);

module.exports = { pollAllAdmins };
