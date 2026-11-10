const cron = require('node-cron');
const Task = require('../models/Task');
const sendReviewRequestEmail = require('../utils/sendReviewEmail');

/**
 * Sends review emails to customers who completed orders before today.
 * Runs daily at 12:15, after waste transfer notes are no longer starting at the same minute.
 * Tasks completed on day X (any time) will receive a review email on day X+1 at 12:15.
 * Only sends one review email per customer (by email address).
 *
 * NOTE: repeatCustomer is now handled at order creation time in taskCtrl.createTask.
 * This cron job no longer modifies the repeatCustomer field.
 */
const REVIEW_EMAIL_PAGE_SIZE = 50;

function normalizeEmail(email) {
    return email ? String(email).trim().toLowerCase() : '';
}

function pendingReviewFilter(todayStart, afterFinishDate) {
    const filter = {
        taskStatus: 'Completed',
        reviewRequestSent: { $ne: true },
        preventReviewEmail: { $ne: true },
        finishDate: { $exists: true, $lt: todayStart },
        email: { $exists: true, $ne: null, $ne: '' },
        createdBy: { $ne: 'MigrationScript' },
    };

    if (!afterFinishDate) return filter;

    // Next page starts after this finish time. Jobs that share a finish time
    // are loaded together, so the page split does not drop one of them.
    filter.finishDate = { $gt: afterFinishDate, $lt: todayStart };
    return filter;
}

/** One lookup for the customers on this page who have not been checked yet. */
async function findCustomersAlreadySent(emails) {
    if (!emails.length) return new Set();

    const rows = await Task.aggregate([
        { $match: { reviewRequestSent: true, email: { $type: 'string', $ne: '' } } },
        { $project: { emailNorm: { $toLower: '$email' } } },
        { $match: { emailNorm: { $in: emails } } },
    ]);

    return new Set(rows.map((row) => row.emailNorm));
}

async function sendScheduledReviewEmails() {
    try {
        const now = new Date();
        // Tasks completed before today are eligible. Older unsent jobs stay in the backlog.
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

        let emailsSent = 0;
        let emailsSkipped = 0;
        let scanned = 0;
        const processedCustomers = new Set();
        const alreadyReceived = new Set();
        const checkedNotSent = new Set();
        let afterFinishDate = null;

        while (true) {
            const page = await Task.find(pendingReviewFilter(todayStart, afterFinishDate))
                .sort({ finishDate: 1 })
                .limit(REVIEW_EMAIL_PAGE_SIZE);

            if (!page.length) break;

            let tasksToProcess = page;
            const boundary = page[page.length - 1].finishDate;

            // Same sort as before: finish time only. When the page stops in the
            // middle of one finish time, load the rest of that time too.
            if (page.length === REVIEW_EMAIL_PAGE_SIZE) {
                const earlier = page.filter((task) => task.finishDate.getTime() !== boundary.getTime());
                const sameTime = await Task.find({
                    ...pendingReviewFilter(todayStart),
                    finishDate: boundary,
                }).sort({ finishDate: 1 });
                tasksToProcess = earlier.concat(sameTime);
            }

            afterFinishDate = boundary;
            scanned += tasksToProcess.length;

            const emailsToCheck = [];
            for (const task of tasksToProcess) {
                const emailNormalized = normalizeEmail(task.email);
                if (
                    !emailNormalized
                    || processedCustomers.has(emailNormalized)
                    || alreadyReceived.has(emailNormalized)
                    || checkedNotSent.has(emailNormalized)
                ) {
                    continue;
                }
                emailsToCheck.push(emailNormalized);
                checkedNotSent.add(emailNormalized);
            }

            const sentOnPage = await findCustomersAlreadySent([...new Set(emailsToCheck)]);
            for (const emailNormalized of sentOnPage) {
                alreadyReceived.add(emailNormalized);
                checkedNotSent.delete(emailNormalized);
            }

            for (const task of tasksToProcess) {
                const emailNormalized = normalizeEmail(task.email);

                if (processedCustomers.has(emailNormalized)) {
                    console.log(`[Send Review Emails] Skipping task ${task.orderNumber} - customer ${task.email} already processed`);
                    task.reviewRequestSent = true;
                    await task.save();
                    emailsSkipped++;
                    continue;
                }

                if (alreadyReceived.has(emailNormalized)) {
                    console.log(`[Send Review Emails] Skipping task ${task.orderNumber} - customer ${task.email} already received review email`);
                    task.reviewRequestSent = true;
                    await task.save();
                    emailsSkipped++;
                    continue;
                }

                try {
                    await sendReviewRequestEmail({
                        email: task.email,
                        firstName: task.firstName,
                        orderNumber: task.orderNumber
                    });

                    task.reviewRequestSent = true;
                    await task.save();
                    console.log(`[Send Review Emails] Sent review email to ${task.email} for task ${task.orderNumber}`);
                    processedCustomers.add(emailNormalized);
                    emailsSent++;
                } catch (error) {
                    console.error(`[Send Review Emails] Error sending email to ${task.email} for task ${task.orderNumber}:`, error);
                    // Don't mark as sent if email failed, so it can be retried.
                    // Leave the customer out of processedCustomers so a later task can try.
                    checkedNotSent.delete(emailNormalized);
                }
            }

            if (page.length < REVIEW_EMAIL_PAGE_SIZE) break;
        }

        console.log(`[Send Review Emails] Completed: ${emailsSent} emails sent, ${emailsSkipped} skipped, ${scanned} scanned`);
    } catch (error) {
        console.error('[Send Review Emails] Error in sendScheduledReviewEmails:', error);
    }
}

// 12:15, so this does not start in the same minute as waste transfer notes.
// Cron format: minute hour day month dayOfWeek
cron.schedule('15 12 * * *', sendScheduledReviewEmails);

console.log('[Send Review Emails] Scheduler running - will send review emails daily at 12:15');

module.exports = { sendScheduledReviewEmails };

