const cron = require('node-cron');
const Notification = require('../models/Notification');

// Schedule a job to run every day at midnight
cron.schedule('0 0 * * *', async () => {
    try {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7); // 7 days ago
        oneWeekAgo.setHours(0, 0, 0, 0); // Start of that day

        // Delete only notifications older than a week that have been read
        const result = await Notification.deleteMany({
            createdAt: { $lt: oneWeekAgo },
            read: true,
        });

        console.log(
            `Cleared old notifications at midnight. Deleted count: ${result.deletedCount}`
        );
    } catch (error) {
        console.error('Error clearing notifications at midnight:', error);
    }
});

console.log('Clear notifications scheduler running...');


