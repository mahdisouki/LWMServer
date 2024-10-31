const cron = require('node-cron');
const Truck = require('../models/Truck');


// Schedule a job to run every day at midnight
cron.schedule('0 0 * * *', async () => {
    try {
      const currentDate = new Date();
      
      // Find trucks where driver-specific days have ended
      const trucksToUpdate = await Truck.find({
        driverSpecificDays: { endDate: { $lt: currentDate } }
      });

      // Update the trucks by removing the driverId
      for (const truck of trucksToUpdate) {
        truck.driverId = undefined; // Clear the driverId
        truck.driverSpecificDays = undefined; // Optionally clear the specific days
        await truck.save();
        console.log(`Driver removed from truck: ${truck.name}`);
      }

      // Find trucks where helper-specific days have ended
      const helperTrucksToUpdate = await Truck.find({
        helperSpecificDays: { endDate: { $lt: currentDate } }
      });

      // Update the trucks by removing the helperId
      for (const truck of helperTrucksToUpdate) {
        truck.helperId = undefined; // Clear the helperId
        truck.helperSpecificDays = undefined; // Optionally clear the specific days
        await truck.save();
        console.log(`Helper removed from truck: ${truck.name}`);
      }
    } catch (error) {
      console.error('Error removing drivers/helpers:', error);
    }
  });
  
  // Start the scheduler
  console.log('Scheduler running...');