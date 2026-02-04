const DailySheet = require('../models/DailySheet'); // Import the DailySheet model
const Task = require('../models/Task');
const TippingRequest = require('../models/TippingRequest');
const Driver = require('../models/Driver');
const APIfeatures = require('../utils/APIFeatures');
const Truck = require('../models/Truck')
const { User } = require('../models/User')
const Payroll = require('../models/Payroll');
const dailySheetController = {
  generateDailySheetsForAllDrivers: async (req, res) => {
    try {
      // Parse and validate input date
      const inputDate = req.body.date ? new Date(req.body.date) : new Date();
      if (isNaN(inputDate)) {
        return res.status(400).json({ message: 'Invalid date format' });
      }

      // Start and end of the day
      const startOfDay = new Date(inputDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(inputDate);
      endOfDay.setHours(23, 59, 59, 999);

      const formattedDate = req.body.date || new Date().toISOString().split('T')[0];

      const drivers = await Driver.find();
      const dailySheets = [];

      for (const driver of drivers) {
        const trucks = await Truck.find({ driverId: driver._id });
        const allTaskIdsForDate = [];
        const allTippingRequestIdsForDate = [];

        for (const truck of trucks) {
          if (!truck.tasks) {
            console.log(`Truck ${truck.name} has no tasks`);
            continue;
          }

          let tasksForDate = [];

          // Handle both Map and Object structures
          if (truck.tasks instanceof Map) {
            // If it's a Map
            const taskKeys = Array.from(truck.tasks.keys());
            console.log(`Truck ${truck.name} task keys (Map):`, taskKeys);
            if (!taskKeys.includes(formattedDate)) {
              console.log(`⚠️ No tasks for ${formattedDate}. Try one of these: ${taskKeys.join(', ')}`);
            }
            tasksForDate = truck.tasks.get(formattedDate) || [];
          } else if (typeof truck.tasks === 'object') {
            // If it's an Object
            const taskKeys = Object.keys(truck.tasks);
            console.log(`Truck ${truck.name} task keys (Object):`, taskKeys);
            if (!taskKeys.includes(formattedDate)) {
              console.log(`⚠️ No tasks for ${formattedDate}. Try one of these: ${taskKeys.join(', ')}`);
            }
            tasksForDate = truck.tasks[formattedDate] || [];
          }

          console.log(`Tasks for ${formattedDate} in truck ${truck.name}:`, tasksForDate);

          // Extract task IDs and tipping request IDs from the tasks array
          if (Array.isArray(tasksForDate)) {
            tasksForDate.forEach(task => {
              // Handle both string IDs and objects with taskId property
              let taskId = null;
              let taskType = null;

              if (typeof task === 'string') {
                // Legacy format: just a string ID (assume it's a task)
                taskId = task;
                taskType = 'task';
              } else if (task && task.taskId) {
                taskId = task.taskId;
                taskType = task.type || 'task'; // Default to 'task' if type not specified
              }

              if (taskId) {
                // Check if it's a tipping request or a task
                if (taskType === 'TippingRequest' || taskType === 'tipping_request') {
                  allTippingRequestIdsForDate.push(taskId);
                } else {
                  // Default to task (for backward compatibility)
                  allTaskIdsForDate.push(taskId);
                }
              }
            });

            console.log(`Extracted task IDs for ${formattedDate}:`, allTaskIdsForDate);
            console.log(`Extracted tipping request IDs for ${formattedDate}:`, allTippingRequestIdsForDate);
          }
        }

        // Fetch jobs based on task IDs and status
        const jobsDone = await Task.find({
          _id: { $in: allTaskIdsForDate },
          taskStatus: 'Completed',
        });

        const jobsPending = await Task.find({
          _id: { $in: allTaskIdsForDate },
          taskStatus: { $in: ['Processing', 'New'] },
        });

        const jobsCancelled = await Task.find({
          _id: { $in: allTaskIdsForDate },
          taskStatus: 'Declined',
        });

        // Fetch tipping requests from the truck's tasks Map (not by userId)
        const tippingRequests = allTippingRequestIdsForDate.length > 0
          ? await TippingRequest.find({
            _id: { $in: allTippingRequestIdsForDate }
          })
          : [];

        // Calculate income from tasks
        const totalCashIncome = jobsDone.reduce((acc, job) => {
          if (job.paymentStatus === 'Paid' && job.paymentMethod === 'Cash') {
            return acc + job.totalPrice;
          }
          return acc;
        }, 0);

        // Calculate income from accepted tipping requests
        const totalTippingIncome = tippingRequests.reduce((acc, tip) => {
          if (tip.status === 'Accepted' && tip.price) {
            return acc + tip.price;
          }
          return acc;
        }, 0);

        const totalIncome = totalCashIncome + totalTippingIncome;

        // Upsert daily sheet
        const dailySheet = await DailySheet.findOneAndUpdate(
          { driverId: driver._id, date: formattedDate },
          {
            driverId: driver._id,
            date: new Date(formattedDate), // ensure correct format
            jobsDone: jobsDone.map(job => job._id),
            jobsPending: jobsPending.map(job => job._id),
            jobsCancelled: jobsCancelled.map(job => job._id),
            tippingRequests: tippingRequests.map(tip => tip._id),
            income: {
              cash: totalCashIncome,
              tipping: totalTippingIncome,
              total: totalIncome,
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
      ).populate({
        path: 'tippingRequests',
        populate: {
          path: 'tippingPlace',
          model: 'TippingPlace',
        },
      });

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
  addFuelLog: async (req, res) => {
    try {
      const { driverId, date } = req.params;
      const { amount, litres, station, addedBy } = req.body;

      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      const dailySheet = await DailySheet.findOne({
        driverId,
        date: { $gte: startDate, $lte: endDate },
      });

      if (!dailySheet) {
        return res.status(404).json({ message: 'Daily sheet not found for that date' });
      }

      dailySheet.fuelLogs.push({
        amount,
        litres,
        station,
        addedBy,
      });

      await dailySheet.save();

      res.status(200).json({ message: 'Fuel log added', fuelLogs: dailySheet.fuelLogs });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to add fuel log', error: error.message });
    }
  },
  updateFuelLog: async (req, res) => {
    try {
      const { driverId, date, fuelLogId } = req.params;
      const { amount, litres, station, time, date: newDate } = req.body;

      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      const dailySheet = await DailySheet.findOne({
        driverId,
        date: { $gte: startDate, $lte: endDate },
      });

      if (!dailySheet) {
        return res.status(404).json({ message: 'Daily sheet not found' });
      }

      const log = dailySheet.fuelLogs.id(fuelLogId);
      if (!log) {
        return res.status(404).json({ message: 'Fuel log not found' });
      }

      // Optional: authorize only admin or original user
      // if (String(log.addedBy) !== String(req.user._id) && req.user.role !== 'admin') {
      //   return res.status(403).json({ message: 'Not authorized to edit this log' });
      // }

      // If a new date is provided, move the fuel log to that date's daily sheet
      if (newDate !== undefined) {
        const newDateObj = new Date(newDate);
        const newStartDate = new Date(newDateObj);
        newStartDate.setHours(0, 0, 0, 0);
        const newEndDate = new Date(newDateObj);
        newEndDate.setHours(23, 59, 59, 999);

        // Find or create the daily sheet for the new date
        let targetDailySheet = await DailySheet.findOne({
          driverId,
          date: { $gte: newStartDate, $lte: newEndDate },
        });

        if (!targetDailySheet) {
          // Create a new daily sheet for the new date
          targetDailySheet = new DailySheet({
            driverId,
            date: newDateObj,
            fuelLogs: [],
          });
        }

        // Save the current log data before removing it
        const logData = {
          amount: amount !== undefined ? amount : log.amount,
          litres: litres !== undefined ? litres : log.litres,
          station: station !== undefined ? station : log.station,
          time: time !== undefined ? new Date(time) : log.time,
          addedBy: log.addedBy,
        };

        // Remove the log from the current daily sheet
        dailySheet.fuelLogs.pull({ _id: fuelLogId });
        await dailySheet.save();

        // Add the log to the new daily sheet with updated data
        targetDailySheet.fuelLogs.push(logData);
        await targetDailySheet.save();

        // Get the newly added log for response
        const newLog = targetDailySheet.fuelLogs[targetDailySheet.fuelLogs.length - 1];

        res.status(200).json({ message: 'Fuel log updated and moved to new date', fuelLog: newLog });
      } else {
        // Just update the properties without moving
        if (amount !== undefined) log.amount = amount;
        if (litres !== undefined) log.litres = litres;
        if (station !== undefined) log.station = station;
        if (time !== undefined) log.time = new Date(time);

        await dailySheet.save();

        res.status(200).json({ message: 'Fuel log updated', fuelLog: log });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Failed to update fuel log', error: err.message });
    }
  },
  deleteFuelLog: async (req, res) => {
    try {
      const { driverId, date, fuelLogId } = req.params;

      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      const dailySheet = await DailySheet.findOne({
        driverId,
        date: { $gte: startDate, $lte: endDate },
      });

      if (!dailySheet)
        return res.status(404).json({ message: 'Daily sheet not found' });

      const logExists = dailySheet.fuelLogs.id(fuelLogId);
      if (!logExists)
        return res.status(404).json({ message: 'Fuel log not found' });


      dailySheet.fuelLogs.pull({ _id: fuelLogId }); // ✅ FIXED
      await dailySheet.save();

      res.status(200).json({ message: 'Fuel log deleted' });
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ message: 'Failed to delete fuel log', error: err.message });
    }
  },
  getAllFuelLogs: async (req, res) => {
    try {
      const pipeline = [
        { $unwind: '$fuelLogs' },
        {
          $project: {
            _id: '$fuelLogs._id',
            driverId: 1,
            date: 1,
            amount: '$fuelLogs.amount',
            litres: '$fuelLogs.litres',
            time: '$fuelLogs.time',
            station: '$fuelLogs.station',
            addedBy: '$fuelLogs.addedBy',
          },
        },
        { $sort: { time: -1 } },
      ];

      const fuelLogs = await DailySheet.aggregate(pipeline);

      res.status(200).json({
        message: 'All fuel logs retrieved',
        count: fuelLogs.length,
        fuelLogs,
      });
    } catch (error) {
      console.error(error);
      res
        .status(500)
        .json({ message: 'Failed to fetch fuel logs', error: error.message });
    }
  },
  getFuelLogs: async (req, res) => {
    try {
      const { driverId, date } = req.params;

      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      const dailySheet = await DailySheet.findOne({
        driverId,
        date: { $gte: startDate, $lte: endDate },
      }).select('fuelLogs driverId date');

      if (!dailySheet) {
        return res
          .status(404)
          .json({ message: 'Daily sheet not found for that date' });
      }

      res.status(200).json({
        message: 'Fuel logs retrieved',
        fuelLogs: dailySheet.fuelLogs,
      });
    } catch (error) {
      console.error(error);
      res
        .status(500)
        .json({ message: 'Failed to fetch fuel logs', error: error.message });
    }
  },
  updateTippingPrice: async (req, res) => {
    try {
      const { tippingRequestId } = req.params;
      const { price } = req.body;

      if (typeof price !== 'number' || price < 0) {
        return res.status(400).json({ message: 'Invalid price value' });
      }

      const tippingRequest = await TippingRequest.findById(tippingRequestId);

      if (!tippingRequest) {
        return res.status(404).json({ message: 'Tipping request not found' });
      }

      // Optional: authorize admin or owner
      // if (req.user.role !== 'admin' && tippingRequest.userId.toString() !== req.user._id.toString()) {
      //   return res.status(403).json({ message: 'Not authorized to update tipping price' });
      // }

      tippingRequest.price = price;
      await tippingRequest.save();

      res.status(200).json({ message: 'Tipping price updated successfully', tippingRequest });
    } catch (error) {
      console.error('Error updating tipping price:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  },
  addExpense: async (req, res) => {
    try {
      const { driverId, date } = req.params;
      const { reason, amount, location, addedBy } = req.body;

      if (!reason || amount == null) {
        return res.status(400).json({ message: 'Reason and amount are required.' });
      }
      const receiptUrl = req.file ? req.file.path : null;
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      const dailySheet = await DailySheet.findOne({
        driverId,
        date: { $gte: startDate, $lte: endDate },
      });

      if (!dailySheet) {
        return res.status(404).json({ message: 'Daily sheet not found for that date' });
      }

      dailySheet.expenses.push({
        reason,
        amount,
        location,
        receiptUrl,
        addedBy,
      });

      await dailySheet.save();

      res.status(200).json({ message: 'Expense added', expenses: dailySheet.expenses });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to add expense', error: error.message });
    }
  },
  updateExpense: async (req, res) => {
    try {
      const { driverId, date, expenseId } = req.params;
      const { reason, amount, location } = req.body;

      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      const dailySheet = await DailySheet.findOne({
        driverId,
        date: { $gte: startDate, $lte: endDate },
      });

      if (!dailySheet) return res.status(404).json({ message: 'Daily sheet not found' });

      const expense = dailySheet.expenses.id(expenseId);
      if (!expense) return res.status(404).json({ message: 'Expense not found' });

      if (reason !== undefined) expense.reason = reason;
      if (amount !== undefined) expense.amount = amount;
      if (location !== undefined) expense.location = location;
      if (req.file) expense.receiptUrl = req.file.path;

      await dailySheet.save();

      res.status(200).json({ message: 'Expense updated', expense });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to update expense', error: error.message });
    }
  },
  deleteExpense: async (req, res) => {
    try {
      const { driverId, date, expenseId } = req.params;

      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      const dailySheet = await DailySheet.findOne({
        driverId,
        date: { $gte: startDate, $lte: endDate },
      });

      if (!dailySheet) return res.status(404).json({ message: 'Daily sheet not found' });

      const exists = dailySheet.expenses.id(expenseId);
      if (!exists) return res.status(404).json({ message: 'Expense not found' });

      dailySheet.expenses.pull({ _id: expenseId });

      await dailySheet.save();

      res.status(200).json({ message: 'Expense deleted' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to delete expense', error: error.message });
    }
  },

  // Function to update existing daily sheets when there are changes
  updateExistingDailySheets: async (req, res) => {
    console.log('Updating existing daily sheets');
    try {
      // Parse and validate input date
      const inputDate = req.body.date ? new Date(req.body.date) : new Date();
      if (isNaN(inputDate)) {
        return res.status(400).json({ message: 'Invalid date format' });
      }

      // Start and end of the day
      const startOfDay = new Date(inputDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(inputDate);
      endOfDay.setHours(23, 59, 59, 999);

      const formattedDate = req.body.date || new Date().toISOString().split('T')[0];

      const drivers = await Driver.find();
      const updatedDailySheets = [];

      for (const driver of drivers) {
        // Check if daily sheet exists for this driver and date
        const existingDailySheet = await DailySheet.findOne({
          driverId: driver._id,
          date: { $gte: startOfDay, $lte: endOfDay },
        });

        if (!existingDailySheet) {
          console.log(`No existing daily sheet found for driver ${driver._id} on ${formattedDate}`);
          continue; // Skip if no existing daily sheet
        }

        console.log(`Updating existing daily sheet for driver ${driver._id} on ${formattedDate}`);

        const trucks = await Truck.find({ driverId: driver._id });
        const allTaskIdsForDate = [];
        const allTippingRequestIdsForDate = [];

        for (const truck of trucks) {
          if (!truck.tasks) {
            console.log(`Truck ${truck.name} has no tasks`);
            continue;
          }

          let tasksForDate = [];

          // Handle both Map and Object structures
          if (truck.tasks instanceof Map) {
            // If it's a Map
            const taskKeys = Array.from(truck.tasks.keys());
            console.log(`Truck ${truck.name} task keys (Map):`, taskKeys);
            if (!taskKeys.includes(formattedDate)) {
              console.log(`⚠️ No tasks for ${formattedDate}. Try one of these: ${taskKeys.join(', ')}`);
            }
            tasksForDate = truck.tasks.get(formattedDate) || [];
          } else if (typeof truck.tasks === 'object') {
            // If it's an Object
            const taskKeys = Object.keys(truck.tasks);
            console.log(`Truck ${truck.name} task keys (Object):`, taskKeys);
            if (!taskKeys.includes(formattedDate)) {
              console.log(`⚠️ No tasks for ${formattedDate}. Try one of these: ${taskKeys.join(', ')}`);
            }
            tasksForDate = truck.tasks[formattedDate] || [];
          }

          console.log(`Tasks for ${formattedDate} in truck ${truck.name}:`, tasksForDate);

          // Extract task IDs and tipping request IDs from the tasks array
          if (Array.isArray(tasksForDate)) {
            tasksForDate.forEach(task => {
              // Handle both string IDs and objects with taskId property
              let taskId = null;
              let taskType = null;

              if (typeof task === 'string') {
                // Legacy format: just a string ID (assume it's a task)
                taskId = task;
                taskType = 'task';
              } else if (task && task.taskId) {
                taskId = task.taskId;
                taskType = task.type || 'task'; // Default to 'task' if type not specified
              }

              if (taskId) {
                // Check if it's a tipping request or a task
                if (taskType === 'TippingRequest' || taskType === 'tipping_request') {
                  allTippingRequestIdsForDate.push(taskId);
                } else {
                  // Default to task (for backward compatibility)
                  allTaskIdsForDate.push(taskId);
                }
              }
            });

            console.log(`Extracted task IDs for ${formattedDate}:`, allTaskIdsForDate);
            console.log(`Extracted tipping request IDs for ${formattedDate}:`, allTippingRequestIdsForDate);
          }
        }

        // Fetch jobs based on task IDs and status
        const jobsDone = await Task.find({
          _id: { $in: allTaskIdsForDate },
          taskStatus: 'Completed',
        });

        const jobsPending = await Task.find({
          _id: { $in: allTaskIdsForDate },
          taskStatus: { $in: ['Processing', 'New'] },
        });

        const jobsCancelled = await Task.find({
          _id: { $in: allTaskIdsForDate },
          taskStatus: { $in: ['Declined', 'Cancelled'] },
        });

        // Fetch tipping requests from the truck's tasks Map (not by userId)
        const tippingRequests = allTippingRequestIdsForDate.length > 0
          ? await TippingRequest.find({
            _id: { $in: allTippingRequestIdsForDate }
          })
          : [];

        // Calculate income from tasks
        const totalCashIncome = jobsDone.reduce((acc, job) => {
          if (job.paymentStatus === 'Paid' && job.paymentMethod === 'Cash') {
            return acc + job.totalPrice;
          }
          return acc;
        }, 0);

        // Calculate income from accepted tipping requests
        const totalTippingIncome = tippingRequests.reduce((acc, tip) => {
          if (tip.status === 'Accepted' && tip.price) {
            return acc + tip.price;
          }
          return acc;
        }, 0);

        const totalIncome = totalCashIncome + totalTippingIncome;

        // Update the existing daily sheet
        const updatedDailySheet = await DailySheet.findByIdAndUpdate(
          existingDailySheet._id,
          {
            jobsDone: jobsDone.map(job => job._id),
            jobsPending: jobsPending.map(job => job._id),
            jobsCancelled: jobsCancelled.map(job => job._id),
            tippingRequests: tippingRequests.map(tip => tip._id),
            income: {
              cash: totalCashIncome,
              tipping: totalTippingIncome,
              total: totalIncome,
            },
          },
          { new: true }
        );

        updatedDailySheets.push(updatedDailySheet);
        console.log(`Daily sheet updated for driver ${driver._id}:`, {
          jobsDone: jobsDone.length,
          jobsPending: jobsPending.length,
          jobsCancelled: jobsCancelled.length,
          tippingRequests: tippingRequests.length,
          totalIncome: totalIncome,
          cashIncome: totalCashIncome,
          tippingIncome: totalTippingIncome
        });
      }

      res.status(200).json({
        message: 'Existing daily sheets updated successfully',
        updatedDailySheets,
        totalUpdated: updatedDailySheets.length
      });
    } catch (error) {
      console.error('Error updating existing daily sheets:', error);
      res.status(500).json({
        message: 'Error updating existing daily sheets',
        error: error.message || 'Unknown error occurred',
      });
    }
  },






};
module.exports = dailySheetController;
