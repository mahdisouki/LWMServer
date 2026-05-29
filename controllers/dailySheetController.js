const mongoose = require('mongoose');
const DailySheet = require('../models/DailySheet');
const Task = require('../models/Task');
const TippingRequest = require('../models/TippingRequest');
const Driver = require('../models/Driver');
const APIfeatures = require('../utils/APIFeatures');
const Truck = require('../models/Truck');
const { User } = require('../models/User');
const { getAssignedForDayFromRanges } = require('../services/unitAssignmentLogService');
const Payroll = require('../models/Payroll');
const Expense = require('../models/Expense');
const { recalculatePayrollExpenses } = require('./expenseController');
const Fuel = require('../models/Fuel');
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

      // Force formattedDate to be exactly 'YYYY-MM-DD'
      const year = startOfDay.getFullYear();
      const month = String(startOfDay.getMonth() + 1).padStart(2, '0');
      const day = String(startOfDay.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;

      const drivers = await Driver.find();
      const dailySheets = [];

      for (const driver of drivers) {
        const trucks = await Truck.find({ driverId: driver._id });

        for (const truck of trucks) {
          const allTaskIdsForDate = [];
          const allTippingRequestIdsForDate = [];

          if (!truck.tasks) {
            console.log(`Truck ${truck._id} has no tasks`);
            continue;
          }

          let tasksForDate = [];

          // Handle both Map and Object structures
          if (truck.tasks instanceof Map) {
            // If it's a Map
            const taskKeys = Array.from(truck.tasks.keys());
            console.log(`Truck ${truck._id} task keys (Map):`, taskKeys);
            if (!taskKeys.includes(formattedDate)) {
              console.log(`⚠️ No tasks for ${formattedDate}. Try one of these: ${taskKeys.join(', ')}`);
            }
            tasksForDate = truck.tasks.get(formattedDate) || [];
          } else if (typeof truck.tasks === 'object') {
            // If it's an Object
            const taskKeys = Object.keys(truck.tasks);
            console.log(`Truck ${truck._id} task keys (Object):`, taskKeys);
            if (!taskKeys.includes(formattedDate)) {
              console.log(`⚠️ No tasks for ${formattedDate}. Try one of these: ${taskKeys.join(', ')}`);
            }
            tasksForDate = truck.tasks[formattedDate] || [];
          }

          console.log(`Tasks for ${formattedDate} in truck ${truck._id}:`, tasksForDate);

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

            console.log(`[GENERATE] Extracted task IDs for ${formattedDate} in truck ${truck._id}:`, allTaskIdsForDate.length);
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

          // totalCash = sum of cashReceived from all jobs paid by cash (schema field used for payroll/sheets)
          const allJobsForTotalCash = [...jobsDone, ...jobsPending, ...jobsCancelled];
          const totalCash = allJobsForTotalCash
            .filter((t) => (t.paymentMethod || '').toLowerCase() === 'cash')
            .reduce((sum, t) => sum + (t.cashReceived || 0), 0);

          // Who was assigned to this truck on this day (from UnitAssignmentLogRange)? Fall back to truck if none.
          const assigned = await getAssignedForDayFromRanges(truck._id, formattedDate);

          // Upsert daily sheet
          const dailySheet = await DailySheet.findOneAndUpdate(
            { 
              driverId: driver._id, 
              truckId: truck._id,
              date: { $gte: startOfDay, $lte: endOfDay } 
            },
            {
              driverId: assigned.driverId || driver._id,
              truckId: truck._id,
              vanId: assigned.vanId || truck.vanId,
              helperId: assigned.helperId || truck.helperId,
              date: new Date(formattedDate), // ensure correct format
              jobsDone: jobsDone.map(job => job._id),
              jobsPending: jobsPending.map(job => job._id),
              jobsCancelled: jobsCancelled.map(job => job._id),
              tippingRequests: tippingRequests.map(tip => tip._id),
              totalCash,
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
        { path: 'truckId' },
        { path: 'vanId' },
        { path: 'helperId' },
        { path: 'jobsDone' },
        { path: 'jobsPending' },
        { path: 'jobsCancelled' },
        {
          path: 'tippingRequests',
          populate: {
            path: 'tippingPlace',
            model: 'TippingPlace',
            match: {},
          },
        },
        { path: 'fuelLogs' },
        { path: 'expenses' },
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
      console.log('updates', updates);
      console.log('driverId', driverId);
      console.log('date', date);

      const dailySheet = await DailySheet.findOneAndUpdate(
        { driverId, date, ...(req.body.truckId && { truckId: req.body.truckId }) },
        updates,
        { new: true },
      ).populate('driverId truckId vanId helperId jobsDone jobsPending jobsCancelled tippingRequests');

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
        ...(req.query.truckId && { truckId: req.query.truckId }),
      }      ).populate(
        'driverId truckId vanId helperId jobsDone jobsPending jobsCancelled tippingRequests fuelLogs expenses',
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
      const { amount, litres, station, addedBy, time: timeBody, imageProof: imageProofBody } =
        req.body;

      const fuelAmount =
        amount != null && !Number.isNaN(Number(amount)) ? Number(amount) : 0;

      const imageProof =
        (req.file && req.file.path) ||
        (imageProofBody && String(imageProofBody).trim()) ||
        undefined;

      const startDate = new Date(date);
      if (Number.isNaN(startDate.getTime())) {
        return res.status(400).json({ message: 'Invalid date parameter.' });
      }
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      const dailySheet = await DailySheet.findOne({
        driverId,
        date: { $gte: startDate, $lte: endDate },
      });

      const fuelPayload = {
        driverId,
        amount: fuelAmount,
        litres:
          litres != null && !Number.isNaN(Number(litres))
            ? Number(litres)
            : undefined,
        station,
        addedBy,
        ...(imageProof ? { imageProof } : {}),
        time: timeBody ? new Date(timeBody) : new Date(),
        date: dailySheet ? dailySheet.date || startDate : startDate,
        linkedToDailySheet: !!dailySheet,
        dailySheetId: dailySheet ? dailySheet._id : undefined,
      };

      const fuel = await Fuel.create(fuelPayload);

      if (dailySheet) {
        dailySheet.fuelLogs.push(fuel._id);
        await dailySheet.save();
      }

      const fuelLogs = await Fuel.find({
        driverId,
        date: { $gte: startDate, $lte: endDate },
      }).sort({ time: 1 });
      res.status(200).json({ message: 'Fuel log added', fuelLogs });
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

      const fuel = await Fuel.findOne({
        _id: fuelLogId,
        driverId,
        date: { $gte: startDate, $lte: endDate },
      });
      if (!fuel) {
        return res.status(404).json({ message: 'Fuel log not found' });
      }

      if (newDate !== undefined) {
        const newDateObj = new Date(newDate);
        const newStartDate = new Date(newDateObj);
        newStartDate.setHours(0, 0, 0, 0);
        const newEndDate = new Date(newDateObj);
        newEndDate.setHours(23, 59, 59, 999);

        const sameCalendarDay = startDate.getTime() === newStartDate.getTime();

        if (sameCalendarDay) {
          if (amount !== undefined) fuel.amount = Number(amount);
          if (litres !== undefined) fuel.litres = Number(litres);
          if (station !== undefined) fuel.station = station;
          if (time !== undefined) fuel.time = new Date(time);
          await fuel.save();
          return res.status(200).json({ message: 'Fuel log updated', fuelLog: fuel });
        }

        const oldSheetId = fuel.dailySheetId;
        if (oldSheetId) {
          await DailySheet.findByIdAndUpdate(oldSheetId, {
            $pull: { fuelLogs: fuel._id },
          });
        }

        const targetDailySheet = await DailySheet.findOne({
          driverId,
          date: { $gte: newStartDate, $lte: newEndDate },
        });

        if (amount !== undefined) fuel.amount = Number(amount);
        if (litres !== undefined) fuel.litres = Number(litres);
        if (station !== undefined) fuel.station = station;
        if (time !== undefined) fuel.time = new Date(time);

        if (targetDailySheet) {
          fuel.dailySheetId = targetDailySheet._id;
          fuel.linkedToDailySheet = true;
          fuel.date = targetDailySheet.date || newStartDate;
          await fuel.save();
          targetDailySheet.fuelLogs.push(fuel._id);
          await targetDailySheet.save();
        } else {
          fuel.dailySheetId = undefined;
          fuel.linkedToDailySheet = false;
          fuel.date = newStartDate;
          await fuel.save();
        }

        res.status(200).json({ message: 'Fuel log updated and moved to new date', fuelLog: fuel });
      } else {
        if (amount !== undefined) fuel.amount = Number(amount);
        if (litres !== undefined) fuel.litres = Number(litres);
        if (station !== undefined) fuel.station = station;
        if (time !== undefined) fuel.time = new Date(time);
        await fuel.save();

        res.status(200).json({ message: 'Fuel log updated', fuelLog: fuel });
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

      const fuel = await Fuel.findOne({
        _id: fuelLogId,
        driverId,
        date: { $gte: startDate, $lte: endDate },
      });
      if (!fuel) return res.status(404).json({ message: 'Fuel log not found' });

      if (fuel.dailySheetId) {
        await DailySheet.findByIdAndUpdate(fuel.dailySheetId, {
          $pull: { fuelLogs: fuel._id },
        });
      }

      await Fuel.findByIdAndDelete(fuelLogId);

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
      const fuels = await Fuel.find({})
        .sort({ time: -1 })
        .populate({ path: 'dailySheetId', select: 'driverId date' })
        .lean();

      const fuelLogs = fuels.map((f) => ({
        _id: f._id,
        driverId: f.dailySheetId ? f.dailySheetId.driverId : f.driverId,
        date: f.dailySheetId ? f.dailySheetId.date : f.date,
        amount: f.amount,
        litres: f.litres,
        time: f.time,
        station: f.station,
        addedBy: f.addedBy,
        imageProof: f.imageProof,
      }));

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
  getFuelLogsForDriver: async (req, res) => {
    try {
      const { driverId } = req.params;

      const fuelLogs = await Fuel.find({ driverId }).sort({ date: -1, time: -1 });

      res.status(200).json({
        message: 'Fuel logs retrieved',
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

      const fuelLogs = await Fuel.find({
        driverId,
        date: { $gte: startDate, $lte: endDate },
      }).sort({ time: 1 });

      res.status(200).json({
        message: 'Fuel logs retrieved',
        fuelLogs,
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

      const expenseDate = dailySheet.date || startDate;

      const expense = await Expense.create({
        driverId,
        dailySheetId: dailySheet._id,
        reason,
        amount,
        location,
        receiptUrl,
        addedBy,
        date: expenseDate,
        linkedToDailySheet: true,
      });

      dailySheet.expenses.push(expense._id);
      await dailySheet.save();

      await recalculatePayrollExpenses(expense.date, expense.driverId);

      res.status(200).json({ message: 'Expense added', expense });
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

      const expense = await Expense.findOne({ _id: expenseId, dailySheetId: dailySheet._id });
      if (!expense) return res.status(404).json({ message: 'Expense not found' });

      if (reason !== undefined) expense.reason = reason;
      if (amount !== undefined) expense.amount = amount;
      if (location !== undefined) expense.location = location;
      if (req.file) expense.receiptUrl = req.file.path;
      if (!expense.driverId) expense.driverId = driverId;
      if (!expense.date) expense.date = dailySheet.date || startDate;
      expense.linkedToDailySheet = true;

      await expense.save();

      await recalculatePayrollExpenses(expense.date, expense.driverId);

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

      const expense = await Expense.findOneAndDelete({ _id: expenseId, dailySheetId: dailySheet._id });
      if (!expense) return res.status(404).json({ message: 'Expense not found' });

      // Remove reference from daily sheet
      dailySheet.expenses.pull(expenseId);
      await dailySheet.save();

      const recalcDriverId = expense.driverId || driverId;
      const recalcDate = expense.date || dailySheet.date || startDate;
      if (recalcDriverId && recalcDate) {
        await recalculatePayrollExpenses(recalcDate, recalcDriverId);
      }

      res.status(200).json({ message: 'Expense deleted' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to delete expense', error: error.message });
    }
  },

  // Function to update existing daily sheets when there are changes
  recalculateDailySheetTotalCashForTask: async (taskId) => {
    try {
      if (!taskId) return;
      const id = typeof taskId === 'string' ? new mongoose.Types.ObjectId(taskId) : taskId;
      const sheets = await DailySheet.find({
        $or: [
          { jobsDone: id },
          { jobsPending: id },
          { jobsCancelled: id },
        ],
      });
      if (sheets.length === 0) {
        console.log('[DailySheet] recalculateDailySheetTotalCashForTask: no sheet contains task', String(taskId));
        return;
      }
      for (const sheet of sheets) {
        const allJobIds = [
          ...(sheet.jobsDone || []),
          ...(sheet.jobsPending || []),
          ...(sheet.jobsCancelled || []),
        ];
        const tasks =
          allJobIds.length > 0
            ? await Task.find({
                _id: { $in: allJobIds },
                paymentMethod: 'cash',
              })
            : [];
        const totalCash = tasks.reduce((sum, task) => sum + (task.cashReceived || 0), 0);
        const before = sheet.totalCash ?? 0;
        sheet.totalCash = totalCash;
        await sheet.save();
        console.log(
          '[DailySheet] totalCash updated for task',
          String(taskId),
          'sheet',
          sheet._id.toString(),
          'from',
          before,
          'to',
          totalCash,
        );
      }
    } catch (error) {
      console.error('Error recalculating DailySheet totalCash for task:', error);
    }
  },

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

      // Force formattedDate to be exactly 'YYYY-MM-DD'
      const year = startOfDay.getFullYear();
      const month = String(startOfDay.getMonth() + 1).padStart(2, '0');
      const day = String(startOfDay.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;

      const drivers = await Driver.find();
      const updatedDailySheets = [];

      for (const driver of drivers) {
        const trucks = await Truck.find({ driverId: driver._id });
        for (const truck of trucks) {
          // Find sheet by truckId + date (sheet driver may differ from truck.driverId when using UnitAssignmentLogRange)
          const existingDailySheet = await DailySheet.findOne({
            truckId: truck._id,
            date: { $gte: startOfDay, $lte: endOfDay },
          });

          if (!existingDailySheet) continue;

          const allTaskIdsForDate = [];
          const allTippingRequestIdsForDate = [];
          if (truck.tasks) {
            let tasksForDate = [];
            if (truck.tasks instanceof Map) tasksForDate = truck.tasks.get(formattedDate) || [];
            else if (typeof truck.tasks === 'object') tasksForDate = truck.tasks[formattedDate] || [];
            if (Array.isArray(tasksForDate)) {
              tasksForDate.forEach(task => {
                let taskId = null, taskType = null;
                if (typeof task === 'string') { taskId = task; taskType = 'task'; }
                else if (task && task.taskId) { taskId = task.taskId; taskType = task.type || 'task'; }
                if (taskId) {
                  if (taskType === 'TippingRequest' || taskType === 'tipping_request') allTippingRequestIdsForDate.push(taskId);
                  else allTaskIdsForDate.push(taskId);
                }
              });
            }
          }

          const jobsDone = await Task.find({ _id: { $in: allTaskIdsForDate }, taskStatus: 'Completed' });
          const jobsPending = await Task.find({ _id: { $in: allTaskIdsForDate }, taskStatus: { $in: ['Processing', 'New'] } });
          const jobsCancelled = await Task.find({ _id: { $in: allTaskIdsForDate }, taskStatus: { $in: ['Declined', 'Cancelled'] } });
          const tippingRequests = allTippingRequestIdsForDate.length > 0
            ? await TippingRequest.find({ _id: { $in: allTippingRequestIdsForDate } })
            : [];

          const totalCashIncome = jobsDone.reduce((acc, job) => (job.paymentStatus === 'Paid' && job.paymentMethod === 'Cash' ? acc + job.totalPrice : acc), 0);
          const totalTippingIncome = tippingRequests.reduce((acc, tip) => (tip.status === 'Accepted' && tip.price ? acc + tip.price : acc), 0);
          const totalIncome = totalCashIncome + totalTippingIncome;

          // totalCash = sum of cashReceived from all jobs (done/pending/cancelled) paid by cash
          const allJobs = [...jobsDone, ...jobsPending, ...jobsCancelled];
          const totalCash = allJobs
            .filter((t) => (t.paymentMethod || '').toLowerCase() === 'cash')
            .reduce((sum, t) => sum + (t.cashReceived || 0), 0);

          const assigned = await getAssignedForDayFromRanges(truck._id, formattedDate);
          const updatedDailySheet = await DailySheet.findByIdAndUpdate(
            existingDailySheet._id,
            {
              driverId: assigned.driverId || existingDailySheet.driverId,
              vanId: assigned.vanId || existingDailySheet.vanId,
              helperId: assigned.helperId || existingDailySheet.helperId,
              jobsDone: jobsDone.map(job => job._id),
              jobsPending: jobsPending.map(job => job._id),
              jobsCancelled: jobsCancelled.map(job => job._id),
              tippingRequests: tippingRequests.map(tip => tip._id),
              totalCash,
              income: { cash: totalCashIncome, tipping: totalTippingIncome, total: totalIncome },
            },
            { new: true }
          );
          if (totalCash > 0 || existingDailySheet.totalCash !== totalCash) {
            console.log('[DailySheet] totalCash set in updateExistingDailySheets for sheet', existingDailySheet._id.toString(), 'to', totalCash);
          }
          updatedDailySheets.push(updatedDailySheet);
        }
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
