const fs = require('fs');
const path = require('path');
const ScheduledEmail = require('../models/ScheduledEmail');
const { sendEmail } = require('../services/gmailService');
const { emitToUser } = require('../socket');

const POLL_INTERVAL_MS = 30 * 1000; // 30 seconds
const MAX_ATTEMPTS = 3;
const SCHEDULED_ATTACHMENTS_DIR = path.join(
  __dirname,
  '../temp/scheduled-attachments'
);

let isRunning = false;

function cleanupAttachmentsDir(scheduledEmailId) {
  const dir = path.join(SCHEDULED_ATTACHMENTS_DIR, String(scheduledEmailId));
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('[Scheduled Email] Failed to cleanup attachments:', dir, err.message);
  }
}

async function sendOne(item) {
  const id = item._id.toString();
  const adminId = item.adminId.toString();

  // gmailService.sendEmail expects { path, originalname, mimetype, size }
  const fileLikeAttachments = (item.attachments || []).map((att) => ({
    path: att.path,
    originalname: att.originalname,
    mimetype: att.mimetype,
    size: att.size,
  }));

  try {
    const result = await sendEmail(
      adminId,
      item.to,
      item.subject,
      item.text,
      fileLikeAttachments
    );

    await ScheduledEmail.updateOne(
      { _id: id },
      {
        status: 'sent',
        sentAt: new Date(),
        gmailMessageId: result?.id || null,
        lastError: null,
      }
    );

    cleanupAttachmentsDir(id);

    console.log(`[Scheduled Email] Sent ${id} for admin ${adminId}`);

    emitToUser(adminId, 'gmail:scheduled-sent', {
      id,
      to: item.to,
      subject: item.subject,
      sentAt: new Date().toISOString(),
    });
  } catch (error) {
    const newAttempts = (item.attempts || 0) + 1;
    const status = newAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending';

    await ScheduledEmail.updateOne(
      { _id: id },
      {
        status,
        attempts: newAttempts,
        lastError: error.message,
      }
    );

    console.error(
      `[Scheduled Email] Send failed for ${id} (attempt ${newAttempts}/${MAX_ATTEMPTS}):`,
      error.message
    );

    if (status === 'failed') {
      cleanupAttachmentsDir(id);
      emitToUser(adminId, 'gmail:scheduled-failed', {
        id,
        to: item.to,
        subject: item.subject,
        error: error.message,
      });
    }
  }
}

async function processDueEmails() {
  if (isRunning) return;
  isRunning = true;

  try {
    const now = new Date();
    // Atomic pick: only items still pending whose time has come.
    // We flip them to "sending" so a second tick won't grab them again.
    while (true) {
      const item = await ScheduledEmail.findOneAndUpdate(
        { status: 'pending', scheduledAt: { $lte: now } },
        { status: 'sending' },
        { new: true, sort: { scheduledAt: 1 } }
      );
      if (!item) break;
      await sendOne(item);
    }
  } catch (error) {
    console.error('[Scheduled Email] Worker error:', error.message);
  } finally {
    isRunning = false;
  }
}

setInterval(processDueEmails, POLL_INTERVAL_MS);

// Run a pass shortly after startup to catch anything missed during downtime.
setTimeout(processDueEmails, 10 * 1000);

console.log(
  `[Scheduled Email] Worker running (every ${POLL_INTERVAL_MS / 1000}s)`
);

module.exports = { processDueEmails };
