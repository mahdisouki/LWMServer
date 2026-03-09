const cron = require('node-cron');
const Task = require('../models/Task');
const sendReviewRequestEmail = require('../utils/sendReviewEmail');

/**
 * Sends review emails to customers who completed orders yesterday.
 * Runs daily at 12:00 PM (noon).
 * Tasks completed on day X (any time) will receive review email on day X+1 at 12 PM.
 * Only sends one review email per customer (by email address).
 *
 * NOTE: repeatCustomer is now handled at order creation time in taskCtrl.createTask.
 * This cron job no longer modifies the repeatCustomer field.
 */
async function sendScheduledReviewEmails() {
    try {
        const now = new Date();
        // Calculate today at 00:00:00 - this is the cutoff time
        // Tasks completed yesterday (any time) should be sent today at 12 PM
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

        // Find tasks that were completed yesterday (any time) and haven't had review email sent
        // Only check finishDate since we're filtering by taskStatus: 'Completed'
        const tasksToProcess = await Task.find({
            taskStatus: 'Completed',
            reviewRequestSent: { $ne: true },
            preventReviewEmail: { $ne: true }, // Don't send if prevented
            finishDate: { $exists: true, $lt: todayStart }, // Completed before today (i.e., yesterday or earlier)
            email: { $exists: true, $ne: null, $ne: '' } // Must have email
        }).sort({ finishDate: 1 }); // Sort by completion date, oldest first

        console.log(`[Send Review Emails] Found ${tasksToProcess.length} completed tasks to process`);

        let emailsSent = 0;
        let emailsSkipped = 0;
        const processedCustomers = new Set(); // Track customers we've already processed

        // Escape helper for safe case-insensitive exact-match regex queries
        const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        for (const task of tasksToProcess) {
            const emailNormalized = task.email ? String(task.email).trim().toLowerCase() : '';

            // Skip if we've already processed this customer in this run
            if (processedCustomers.has(emailNormalized)) {
                console.log(`[Send Review Emails] Skipping task ${task.orderNumber} - customer ${task.email} already processed`);
                // Mark as sent to prevent future processing attempts
                task.reviewRequestSent = true;
                await task.save();
                emailsSkipped++;
                continue;
            }

            // Check if this customer has already received a review email (from any previous task)
            const emailExactCi = new RegExp(`^${escapeRegExp(emailNormalized)}$`, 'i');
            const customerHasReceivedReview = await Task.findOne({
                email: emailExactCi,
                reviewRequestSent: true,
                _id: { $ne: task._id }
            });

            if (customerHasReceivedReview) {
                console.log(`[Send Review Emails] Skipping task ${task.orderNumber} - customer ${task.email} already received review email`);
                // Mark as sent to prevent future processing attempts
                task.reviewRequestSent = true;
                await task.save();
                emailsSkipped++;
                continue;
            }

            // This is the first time sending review email to this customer
            try {
                await sendReviewRequestEmail({
                    email: task.email,
                    firstName: task.firstName,
                    orderId: task._id.toString()
                });

                // Mark this task as review email sent
                task.reviewRequestSent = true;
                await task.save();
                console.log(`[Send Review Emails] Sent review email to ${task.email} for task ${task.orderNumber}`);
                processedCustomers.add(emailNormalized);
                emailsSent++;
            } catch (error) {
                console.error(`[Send Review Emails] Error sending email to ${task.email} for task ${task.orderNumber}:`, error);
                // Don't mark as sent if email failed, so it can be retried
            }
        }

        console.log(`[Send Review Emails] Completed: ${emailsSent} emails sent, ${emailsSkipped} skipped`);
    } catch (error) {
        console.error('[Send Review Emails] Error in sendScheduledReviewEmails:', error);
    }
}

// Schedule the cron job to run every day at 12:00 PM (noon)
// Cron format: minute hour day month dayOfWeek
// '0 12 * * *' means: at minute 0 of hour 12 (12 PM) every day
cron.schedule('0 12 * * *', sendScheduledReviewEmails);

console.log('[Send Review Emails] Scheduler running - will send review emails daily at 12:00 PM');

module.exports = { sendScheduledReviewEmails };

