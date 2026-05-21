const cron = require('node-cron');
const { cleanupStaleUploadJobs } = require('../services/taskPhotoUploadService');

// Every hour: fail stuck jobs and remove orphaned temp files
cron.schedule('0 * * * *', async () => {
  try {
    await cleanupStaleUploadJobs(2 * 60 * 60 * 1000);
    console.log('✅ Task photo upload cleanup completed');
  } catch (err) {
    console.error('❌ Task photo upload cleanup failed:', err);
  }
});
