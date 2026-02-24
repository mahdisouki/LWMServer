const cron = require('node-cron');
const blueSheetController = require('../controllers/blueSheetController');

// Schedule the cron job for 6:00 PM every day
cron.schedule('0 18 * * *', async () => {
  try {
    console.log('Generating blue sheets for all trucks at 6 PM...');
    
    const today = new Date();
    const date = today.toISOString().split('T')[0]; // YYYY-MM-DD

    await blueSheetController.generateBlueSheetsForAllTrucks({ body: { date } }, {
      status: (code) => ({
        json: (response) => console.log(`Response: ${JSON.stringify(response)}`),
      }),
    });
    
    console.log('Blue sheets generated successfully.');
  } catch (error) {
    console.error('Error running blue sheets cron job:', error);
  }
});

console.log('Blue sheets cron scheduler running (6 PM daily)');
