const cron = require('node-cron');
const Coupon = require('../models/Coupon');

// Schedule a job to run once per day at 3:00 AM
cron.schedule('0 3 * * *', async () => {
    try {
        const now = new Date();
        // Calculate date 3 days ago from now
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

        // Delete expired and unused coupons that exceeded 3 days from expiration date
        // Conditions:
        // 1. expiresAt < threeDaysAgo (expired more than 3 days ago)
        // 2. usageCount === 0 (not used)
        const result = await Coupon.deleteMany({
            expiresAt: { $lt: threeDaysAgo },
            usageCount: 0
        });

        console.log(
            `Deleted expired and unused coupon codes (exceeded 3 days from expiration). Deleted count: ${result.deletedCount}`
        );
    } catch (error) {
        console.error('Error deleting expired coupon codes:', error);
    }
});

console.log('Delete expired coupons scheduler running...');

