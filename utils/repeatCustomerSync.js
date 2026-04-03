const Task = require('../models/Task');

/**
 * Sync repeatCustomer for all tasks sharing an email (case-insensitive).
 * Qualifying tasks exclude paymentStatus === 'Failed' (failed / abandoned payments).
 * repeatCustomer = max(0, qualifyingCount - 1), applied to every task with that email.
 */
async function syncRepeatCustomerForEmail(email) {
  if (!email || !String(email).trim()) return;
  try {
    const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const emailNormalized = String(email).trim().toLowerCase();
    const emailExactCi = new RegExp(`^${escapeRegExp(emailNormalized)}$`, 'i');

    const qualifyingCount = await Task.countDocuments({
      email: emailExactCi,
      paymentStatus: { $ne: 'Failed' },
    });
    const repeatCustomerValue =
      qualifyingCount > 1 ? Math.max(0, qualifyingCount - 1) : 0;

    const repeatUpdateResult = await Task.updateMany(
      { email: emailExactCi },
      { $set: { repeatCustomer: repeatCustomerValue } },
    );
    console.log(
      `[RepeatCustomer] Set repeatCustomer=${repeatCustomerValue} for ${repeatUpdateResult.modifiedCount} task(s) (qualifyingCount=${qualifyingCount}, email=${emailNormalized})`,
    );
  } catch (err) {
    console.error('[RepeatCustomer] Error in syncRepeatCustomerForEmail:', err);
  }
}

module.exports = { syncRepeatCustomerForEmail };
