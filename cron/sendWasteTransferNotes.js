const cron = require('node-cron');
const Task = require('../models/Task');
const { sendWasteTransferNoteEmail } = require('../services/emailsService');

/**
 * Sends Waste Transfer Notes for tasks that are:
 * - completed
 * - paid (or partial_Paid with deposit + remaining both Paid)
 * - not yet sent
 *
 * Runs daily at 12:45. Notes are sent 10 at a time so a backlog is not
 * loaded and emailed in one loop. Older jobs that still have no note are included.
 */
const WTN_BATCH_SIZE = 10;
const WTN_BATCH_DELAY_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pendingWasteTransferFilter(after) {
  const filter = {
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
    createdBy: { $ne: 'MigrationScript' },
  };

  if (!after) return filter;

  // Same order as the old sort: finishDate, then createdAt. _id breaks ties.
  // A failed send clears wasteTransferNoteSent, so skip/limit would skip rows.
  const paymentMatch = filter.$or;
  const cursorMatch = after.finishDate == null
    ? [
        { finishDate: null, createdAt: { $gt: after.createdAt } },
        { finishDate: null, createdAt: after.createdAt, _id: { $gt: after._id } },
        { finishDate: { $type: 'date' } },
      ]
    : [
        { finishDate: { $gt: after.finishDate } },
        { finishDate: after.finishDate, createdAt: { $gt: after.createdAt } },
        { finishDate: after.finishDate, createdAt: after.createdAt, _id: { $gt: after._id } },
      ];

  delete filter.$or;
  filter.$and = [{ $or: paymentMatch }, { $or: cursorMatch }];
  return filter;
}

async function sendScheduledWasteTransferNotes() {
  try {
    let sentCount = 0;
    let failedCount = 0;
    let scanned = 0;
    let after = null;

    while (true) {
      const tasksToProcess = await Task.find(pendingWasteTransferFilter(after))
        .select('_id orderNumber finishDate createdAt')
        .sort({ finishDate: 1, createdAt: 1, _id: 1 })
        .limit(WTN_BATCH_SIZE);

      if (!tasksToProcess.length) break;

      const last = tasksToProcess[tasksToProcess.length - 1];
      after = { finishDate: last.finishDate, createdAt: last.createdAt, _id: last._id };
      scanned += tasksToProcess.length;
      console.log(`[Send WTN] Batch of ${tasksToProcess.length} (${scanned} scanned)`);

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

      if (tasksToProcess.length < WTN_BATCH_SIZE) break;

      await sleep(WTN_BATCH_DELAY_MS);
    }

    console.log(`[Send WTN] Completed: ${sentCount} sent, ${failedCount} failed, ${scanned} scanned`);
  } catch (error) {
    console.error('[Send WTN] Error in sendScheduledWasteTransferNotes:', error);
  }
}

// 12:45, after review emails have started at 12:15.
cron.schedule('45 12 * * *', sendScheduledWasteTransferNotes);

console.log('[Send WTN] Scheduler running - will send WTNs daily at 12:45, 10 at a time');

module.exports = { sendScheduledWasteTransferNotes };
