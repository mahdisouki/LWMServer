const cron = require('node-cron');
const Message = require('../models/Message');

// Schedule a job to run once per day at 2:00 AM
cron.schedule('0 2 * * *', async () => {
  try {
    const now = new Date();
    const fourteenDaysAgo = new Date(
      now.getTime() - 14 * 24 * 60 * 60 * 1000
    );

    // Delete messages older than 14 days
    const result = await Message.deleteMany({
      createdAt: { $lt: fourteenDaysAgo },
    });

    console.log(
      `Cleared chat messages older than 14 days. Deleted count: ${result.deletedCount}`
    );
  } catch (error) {
    console.error('Error clearing old chat messages:', error);
  }
});

console.log('Clear chats scheduler running...');




