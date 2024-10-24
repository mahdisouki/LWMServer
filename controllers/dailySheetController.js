const DailySheet = require('../models/DailySheet'); // Import the DailySheet model
const Task = require('../models/Task');
const TippingRequest = require('../models/TippingRequest');
const Driver = require('../models/Driver');

const dailySheetController = {
    generateDailySheetsForAllDrivers : async (req, res) => {
        try {
          const date = req.body.date || new Date(); // Use provided date or default to today
          const drivers = await Driver.find(); // Fetch all drivers
          
          const dailySheets = [];
      
          for (const driver of drivers) {
            // Find tasks and tipping requests for the driver
            const jobsDone = await Task.find({ truckId: driver._id, taskStatus: "Completed", date });
            const jobsPending = await Task.find({ truckId: driver._id, taskStatus: "Processing", date });
            const jobsCancelled = await Task.find({ truckId: driver._id, taskStatus: "Declined", date });
      
            const tippingRequests = await TippingRequest.find({ 
              truckId: driver._id, 
              createdAt: { 
                $gte: new Date(date.setHours(0, 0, 0, 0)), 
                $lt: new Date(date.setHours(23, 59, 59, 999)) 
              } 
            });
      
            // Calculate cash income for the day
            let totalCashIncome = 0;
            jobsDone.forEach(job => {
              if (job.paymentStatus === 'Paid' && job.paymentMethod === 'Cash') {
                totalCashIncome += job.price;
              }
            });
      
            // Create or update the daily sheet for the driver
            let dailySheet = await DailySheet.findOneAndUpdate(
              { driverId: driver._id, date },
              {
                driverId: driver._id,
                jobsDone: jobsDone.map(job => job._id),
                jobsPending: jobsPending.map(job => job._id),
                jobsCancelled: jobsCancelled.map(job => job._id),
                tippingRequests: tippingRequests.map(tip => tip._id),
                income: {
                  cash: totalCashIncome,
                  total: totalCashIncome
                }
              },
              { new: true, upsert: true }
            );
            
            dailySheets.push(dailySheet);
          }
      
          res.status(201).json({ message: 'Daily sheets generated', dailySheets });
        } catch (error) {
          console.error("Error generating daily sheets:", error);
          res.status(500).json({ message: 'Error generating daily sheets', error });
        }
      },
      
      // Get all daily sheets for all drivers for a specific date
      getDailySheetsForAllDrivers : async (req, res) => {
        try {
          const date = req.params.date;
          
          const dailySheets = await DailySheet.find({ date }).populate('driverId jobsDone jobsPending jobsCancelled tippingRequests');
      
          if (!dailySheets || dailySheets.length === 0) {
            return res.status(404).json({ message: 'No daily sheets found for the specified date' });
          }
      
          res.status(200).json(dailySheets);
        } catch (error) {
          console.error("Error fetching daily sheets:", error);
          res.status(500).json({ message: 'Error fetching daily sheets', error });
        }
      },
      
      // Update a daily sheet for a specific driver
      updateDailySheetForDriver : async (req, res) => {
        try {
          const { driverId, date } = req.params;
          const updates = req.body;  // Assume the client sends the updates (jobsDone, jobsPending, etc.)
      
          const dailySheet = await DailySheet.findOneAndUpdate(
            { driverId, date },
            updates,
            { new: true }
          ).populate('driverId jobsDone jobsPending jobsCancelled tippingRequests');
      
          if (!dailySheet) {
            return res.status(404).json({ message: 'Daily sheet not found' });
          }
      
          res.status(200).json({ message: 'Daily sheet updated', dailySheet });
        } catch (error) {
          console.error("Error updating daily sheet:", error);
          res.status(500).json({ message: 'Error updating daily sheet', error });
        }
      }

}
module.exports = dailySheetController;
