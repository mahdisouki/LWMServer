const Task = require('../models/Task');

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match MigrationScript privateNotes of the form:
 *   Original Woo email: customer@example.com
 */
function wooEmailInNotesRe(emailNormalized) {
  return new RegExp(
    `Original Woo email:\\s*${escapeRegExp(emailNormalized)}(?:\\s|$)`,
    'i',
  );
}

/**
 * Tasks that belong to this customer identity:
 * - normal tasks whose `email` matches, OR
 * - MigrationScript tasks whose privateNotes contain Original Woo email: <email>
 */
function peerFilterForEmail(emailNormalized) {
  const emailExactCi = new RegExp(`^${escapeRegExp(emailNormalized)}$`, 'i');
  return {
    $or: [
      { email: emailExactCi },
      { createdBy: 'MigrationScript', privateNotes: wooEmailInNotesRe(emailNormalized) },
    ],
  };
}

/**
 * Sync repeatCustomer for all tasks sharing an email (case-insensitive),
 * including MigrationScript Woo peers that keep the real address in privateNotes.
 *
 * Qualifying tasks exclude paymentStatus === 'Failed' (failed / abandoned payments).
 * repeatCustomer = max(0, qualifyingCount - 1), applied to every peer task.
 *
 * @param {string} email
 * @param {{ silent?: boolean }} [options] — if silent, skip console output (caller logs)
 * @returns {Promise<{ email: string, qualifyingCount: number, repeatCustomer: number, matchedByEmail: number, matchedByWooNotes: number, modifiedCount: number }|undefined>}
 */
async function syncRepeatCustomerForEmail(email, options = {}) {
  if (!email || !String(email).trim()) return;
  try {
    const emailNormalized = String(email).trim().toLowerCase();
    const peerFilter = peerFilterForEmail(emailNormalized);
    const emailExactCi = new RegExp(`^${escapeRegExp(emailNormalized)}$`, 'i');
    const notesRe = wooEmailInNotesRe(emailNormalized);

    const [qualifyingCount, matchedByEmail, matchedByWooNotes] = await Promise.all([
      Task.countDocuments({
        ...peerFilter,
        paymentStatus: { $ne: 'Failed' },
      }),
      Task.countDocuments({ email: emailExactCi }),
      Task.countDocuments({
        createdBy: 'MigrationScript',
        privateNotes: notesRe,
      }),
    ]);

    const repeatCustomerValue =
      qualifyingCount > 1 ? Math.max(0, qualifyingCount - 1) : 0;

    const repeatUpdateResult = await Task.updateMany(
      peerFilter,
      { $set: { repeatCustomer: repeatCustomerValue } },
    );

    const summary = {
      email: emailNormalized,
      qualifyingCount,
      repeatCustomer: repeatCustomerValue,
      matchedByEmail,
      matchedByWooNotes,
      modifiedCount: repeatUpdateResult.modifiedCount,
    };

    if (!options.silent) {
      console.log(
        `[RepeatCustomer] ${emailNormalized} | ` +
          `non-Failed orders: ${qualifyingCount} → repeatCustomer=${repeatCustomerValue} | ` +
          `peers: ${matchedByEmail} by email field, ${matchedByWooNotes} by Woo privateNotes | ` +
          `updated: ${repeatUpdateResult.modifiedCount}`,
      );
    }

    return summary;
  } catch (err) {
    console.error('[RepeatCustomer] Error in syncRepeatCustomerForEmail:', err);
  }
}

module.exports = { syncRepeatCustomerForEmail, peerFilterForEmail, wooEmailInNotesRe };
