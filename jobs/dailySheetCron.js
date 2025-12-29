const cron = require('node-cron');
const dailySheetController = require('../controllers/dailySheetController'); // Adjust the path as necessary

// Schedule the cron job for 3:00 AM every day
cron.schedule('0 3 * * *', async () => {
  try {
    console.log('Generating daily sheets for all drivers at 3 AM...');
    
    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const date = today.toISOString().split('T')[0]; // Format date as YYYY-MM-DD

    // Trigger the function that generates daily sheets for all drivers
    await dailySheetController.generateDailySheetsForAllDrivers({ body: { date } }, {
      status: (code) => ({
        json: (response) => console.log(`Response: ${JSON.stringify(response)}`),
      }),
    });
    
    console.log('Daily sheets generated successfully.');
  } catch (error) {
    console.error('Error running daily sheets cron job:', error);
  }
});
