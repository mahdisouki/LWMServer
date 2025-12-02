const cron = require('node-cron');
const Notification = require('../models/Notification');

// Schedule a job to run every day at midnight
cron.schedule('0 0 * * *', async () => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Start of today

        // Delete notifications created before today (keep today's)
        const result = await Notification.deleteMany({
            createdAt: { $lt: today },
        });

        console.log(
            `Cleared old notifications at midnight. Deleted count: ${result.deletedCount}`
        );
    } catch (error) {
        console.error('Error clearing notifications at midnight:', error);
    }
});

console.log('Clear notifications scheduler running...');


