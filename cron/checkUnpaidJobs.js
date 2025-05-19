const cron = require('node-cron');
const Task = require('../models/Task');
const Notification = require('../models/Notification');

// Get time threshold from environment variable (default to 30 minutes if not set)
const UNPAID_JOB_THRESHOLD_MINUTES = process.env.UNPAID_JOB_THRESHOLD_MINUTES || 30;

// Function to check for unpaid completed jobs
async function checkUnpaidCompletedJobs() {
    try {
        // Calculate timestamp for threshold minutes ago
        const thresholdTimeAgo = new Date(Date.now() - UNPAID_JOB_THRESHOLD_MINUTES * 60 * 1000);

        // Find jobs that are:
        // 1. Completed
        // 2. Unpaid
        // 3. Finished more than threshold minutes ago
        const unpaidJobs = await Task.find({
            taskStatus: 'Completed',
            paymentStatus: 'Unpaid',
            finishDate: { $lt: thresholdTimeAgo }
        });

        // Send notifications for each unpaid job
        for (const job of unpaidJobs) {
            // Create notification for admin
            const notification = new Notification({
                type: 'Orders',
                message: `Job #${job.orderNumber} has been completed for more than ${UNPAID_JOB_THRESHOLD_MINUTES} minutes but is still unpaid. Please check payment status.`,
                userId: process.env.ADMIN_USER_ID
            });

            await notification.save();
        }

        console.log(`Checked for unpaid jobs. Found ${unpaidJobs.length} unpaid completed jobs older than ${UNPAID_JOB_THRESHOLD_MINUTES} minutes.`);
    } catch (error) {
        console.error('Error in checkUnpaidCompletedJobs:', error);
    }
}

// Schedule the cron job to run every 5 minutes
cron.schedule('*/5 * * * *', checkUnpaidCompletedJobs);

module.exports = { checkUnpaidCompletedJobs }; 