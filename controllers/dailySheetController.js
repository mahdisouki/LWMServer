const DailySheet = require('../models/DailySheet'); // Import the DailySheet model
const Task = require('../models/Task');
const TippingRequest = require('../models/TippingRequest');
const Driver = require('../models/Driver');
const APIfeatures = require('../utils/APIFeatures');
const Truck = require('../models/Truck')
const dailySheetController = {
  generateDailySheetsForAllDrivers: async (req, res) => {
    try {
      // Ensure date is a valid Date object
      const inputDate = req.body.date ? new Date(req.body.date) : new Date();
      console.log("input date:" , inputDate)
      if (isNaN(inputDate)) {
        return res.status(400).json({ message: 'Invalid date format' });
      }
  
      const startOfDay = new Date(inputDate);
      console.log('startOfDateBefore' ,startOfDay )
      // startOfDay.setHours(0, 0, 0, 0);
      console.log('startOfDateAfter' ,startOfDay )

      const endOfDay = new Date(inputDate);
      endOfDay.setHours(23, 59, 59, 999);
      console.log("endofDate" , endOfDay)
      const formattedDate = startOfDay.toISOString().split('T')[0]; // Format: 'YYYY-MM-DD'
  
      const drivers = await Driver.find();
      const dailySheets = [];
  
      for (const driver of drivers) {
        // Find trucks associated with the current driver
        const trucks = await Truck.find({ driverId: driver._id });
        console.log(trucks)
        // Gather task IDs for the specific date from `tasksByDate`
        const allTaskIdsForDate = trucks.reduce((acc, truck) => {
          const tasksForDate = truck.tasks?.get(formattedDate) || [] ;
          console.log(tasksForDate);
          console.log(formattedDate)
          return acc.concat(tasksForDate);
        }, []);
  
        // Fetch tasks associated with the trucks for the specific date and status
        const jobsDone = await Task.find({
          _id: { $in: allTaskIdsForDate },
          taskStatus: 'Completed',
          date: { $gte: startOfDay, $lt: endOfDay },
        });
  
        const jobsPending = await Task.find({
          _id: { $in: allTaskIdsForDate },
          taskStatus: 'Processing',
          date: { $gte: startOfDay, $lt: endOfDay },
        });
        console.log(jobsPending)
        const jobsCancelled = await Task.find({
          _id: { $in: allTaskIdsForDate },
          taskStatus: 'Declined',
          date: { $gte: startOfDay, $lt: endOfDay },
        });
  
        const tippingRequests = await TippingRequest.find({
          userId: driver._id,
          createdAt: { $gte: startOfDay, $lt: endOfDay },
        });
        console.log("tippingRequests" , tippingRequests , driver._id)
        // Calculate cash income for the day
        const totalCashIncome = jobsDone.reduce((acc, job) => {
          if (job.paymentStatus === 'Paid' && job.paymentMethod === 'Cash') {
            return acc + job.price;
          }
          return acc;
        }, 0);
  
        // Create or update the daily sheet for the driver
        const dailySheet = await DailySheet.findOneAndUpdate(
          { driverId: driver._id, date: formattedDate },
          {
            driverId: driver._id,
            jobsDone: jobsDone.map((job) => job._id),
            jobsPending: jobsPending.map((job) => job._id),
            jobsCancelled: jobsCancelled.map((job) => job._id),
            tippingRequests: tippingRequests.map((tip) => tip._id),
            income: {
              cash: totalCashIncome,
              total: totalCashIncome,
            },
          },
          { new: true, upsert: true }
        );
  
        dailySheets.push(dailySheet);
      }
  
      res.status(201).json({ message: 'Daily sheets generated', dailySheets });
    } catch (error) {
      console.error('Error generating daily sheets:', error);
      res.status(500).json({
        message: 'Error generating daily sheets',
        error: error.message || 'Unknown error occurred',
      });
    }
  },
  
  
  
  // Get all daily sheets for all drivers for a specific date
  getDailySheetsForAllDrivers: async (req, res) => {
    try {
      const date = req.params.date; // Date should be in "YYYY-MM-DD" format

      // Parse the date and set the start and end times for the entire day
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      // Query for DailySheets within the specified day
      let query = DailySheet.find({
        date: { $gte: startDate, $lte: endDate },
      }).populate([
        { path: 'driverId' },
        { path: 'jobsDone' },
        { path: 'jobsPending' },
        { path: 'jobsCancelled' },
        { 
          path: 'tippingRequests',
          populate: { 
            path: 'tippingPlace', 
            model: 'TippingPlace', // Explicitly specify the model name
            match: {}, // Populate only if tippingPlace exists
          },
        },
      ]);
      const total = await DailySheet.countDocuments(query);

      const features = new APIfeatures(query, req.query);

      features.paginating();

      const dailySheets = await features.query.exec();

      const currentPage = parseInt(req.query.page, 10) || 1;
      const limitNum = parseInt(req.query.limit, 10) || 9;

      if (!dailySheets || dailySheets.length === 0) {
        return res
          .status(404)
          .json({ message: 'No daily sheets found for the specified date' });
      }

      res.status(200).json({
        message: 'Daily sheets retrieved successfully',
        dailySheets,
        meta: {
          currentPage,
          limit: limitNum,
          total,
          count: dailySheets.length,
        },
      });
    } catch (error) {
      console.error('Error fetching daily sheets:', error.message);
      res
        .status(500)
        .json({ message: 'Error fetching daily sheets', error: error.message });
    }
  },

  // Update a daily sheet for a specific driver
  updateDailySheetForDriver: async (req, res) => {
    try {
      const { driverId, date } = req.params;
      const updates = req.body; // Assume the client sends the updates (jobsDone, jobsPending, etc.)

      const dailySheet = await DailySheet.findOneAndUpdate(
        { driverId, date },
        updates,
        { new: true },
      ).populate('driverId jobsDone jobsPending jobsCancelled tippingRequests');

      if (!dailySheet) {
        return res.status(404).json({ message: 'Daily sheet not found' });
      }

      res.status(200).json({ message: 'Daily sheet updated', dailySheet });
    } catch (error) {
      console.error('Error updating daily sheet:', error);
      res.status(500).json({ message: 'Error updating daily sheet', error });
    }
  },
  getDailySheetsbyId: async (req, res) => {
    try {
      const { driverId, date } = req.params;

      // Parse the date and set the start and end times for the entire day
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      // Find the daily sheet for the given driverId and within the specified day
      const dailySheet = await DailySheet.findOne({
        driverId,
        date: { $gte: startDate, $lte: endDate },
      }).populate(
        'driverId jobsDone jobsPending jobsCancelled tippingRequests',
      );

      if (!dailySheet) {
        return res
          .status(404)
          .json({
            message: 'Daily sheet not found for the specified driver and date',
          });
      }

      res.status(200).json(dailySheet);
    } catch (error) {
      console.error('Error fetching daily sheet by ID:', error);
      res
        .status(500)
        .json({ message: 'Error fetching daily sheet by ID', error });
    }
  },
};
module.exports = dailySheetController;
