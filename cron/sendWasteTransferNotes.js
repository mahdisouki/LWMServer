const cron = require('node-cron');
const Task = require('../models/Task');
const { sendWasteTransferNoteEmail } = require('../services/emailsService');

/**
 * Sends Waste Transfer Notes for tasks that are:
 * - completed
 * - paid (or partial_Paid with deposit + remaining both Paid)
 * - not yet sent
 *
 * Runs daily at 12:00 PM (noon).
 */
async function sendScheduledWasteTransferNotes() {
  try {
    const tasksToProcess = await Task.find({
      taskStatus: 'Completed',
      $or: [
        { paymentStatus: 'Paid' },
        {
          paymentStatus: 'partial_Paid',
          'paidAmount.status': 'Paid',
          'remainingAmount.status': 'Paid',
        },
      ],
      wasteTransferNoteSent: { $ne: true },
      email: { $exists: true, $ne: null, $ne: '' },
      createdBy: { $ne: 'MigrationScript' }, // Exclude CSV-migrated orders
    }).sort({ finishDate: 1, createdAt: 1 });

    console.log(`[Send WTN] Found ${tasksToProcess.length} completed paid tasks to process`);

    let sentCount = 0;
    let failedCount = 0;

    for (const task of tasksToProcess) {
      try {
        await sendWasteTransferNoteEmail(task._id);
        sentCount++;
        console.log(`[Send WTN] Sent for order ${task.orderNumber}`);
      } catch (error) {
        failedCount++;
        console.error(`[Send WTN] Failed for order ${task.orderNumber}:`, error.message);
      }
    }

    console.log(`[Send WTN] Completed: ${sentCount} sent, ${failedCount} failed`);
  } catch (error) {
    console.error('[Send WTN] Error in sendScheduledWasteTransferNotes:', error);
  }
}

// Daily at 12:00 PM
cron.schedule('0 12 * * *', sendScheduledWasteTransferNotes);

console.log('[Send WTN] Scheduler running - will send WTNs daily at 12:00 PM');

module.exports = { sendScheduledWasteTransferNotes };
