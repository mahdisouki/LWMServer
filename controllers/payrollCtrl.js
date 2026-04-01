const { User } = require('../models/User');
const Payroll = require('../models/Payroll');
const APIfeatures = require('../utils/APIFeatures');
const Truck = require('../models/Truck');
const Task = require('../models/Task');
const DailySheet = require('../models/DailySheet');
const PcnDamage = require('../models/PcnDamage');
const Expense = require('../models/Expense');

const PayrollCtrl = {
  // Log start time at the beginning of the day
  logStartTime: async (req, res) => {
    const { startTime } = req.body;
    console.log('Starting time:', req.user);
    const userId = req.user._id;

    if (!startTime) {
      return res.status(400).json({ message: 'Start time is required.' });
    }

    try {
      // Check if there is already a payroll entry for today with no end time
      const existingPayroll = await Payroll.findOne({ userId, endTime: null });

      if (existingPayroll) {
        return res
          .status(400)
          .json({ message: 'You have already started work for the day.' });
      }
      const truck = await Truck.findOne({ driverId: req.user._id }) || await Truck.findOne({ helperId: req.user._id })
      // Create a new payroll record with the start time
      const newPayroll = new Payroll({
        userId,
        startTime: new Date(startTime),
        truckId: truck._id
      });

      await newPayroll.save();

      res.status(201).json({
        message: 'Start time logged successfully.',
        payroll: newPayroll,
      });
    } catch (error) {
      console.error('Error logging start time:', error);
      res
        .status(500)
        .json({ message: error.message, error: error.message });
    }
  },

  // Log start break time
  logStartBreak: async (req, res) => {
    const { startBreak } = req.body;
    const userId = req.user._id;

    if (!startBreak) {
      return res.status(400).json({ message: 'Start break time is required.' });
    }

    try {
      // Find the payroll entry for the day that has no end time
      const payroll = await Payroll.findOne({ userId, endTime: null });
      if (!payroll) {
        return res
          .status(404)
          .json({ message: 'Start time not logged for today.' });
      }

      // Check if break is already started
      if (payroll.startBreak && !payroll.endBreak) {
        return res
          .status(400)
          .json({ message: 'Break already started. Please end the current break first.' });
      }

      const startBreakTime = new Date(startBreak);
      const start = payroll.startTime;

      if (startBreakTime < start) {
        return res
          .status(400)
          .json({ message: 'Break start time must be after work start time.' });
      }

      payroll.startBreak = startBreakTime;
      await payroll.save();

      res.status(200).json({
        message: 'Break start time logged successfully.',
        payroll,
      });
    } catch (error) {
      console.error('Error logging break start time:', error);
      res
        .status(500)
        .json({ message: 'Failed to log break start time.', error: error.message });
    }
  },

  // Log end break time
  logEndBreak: async (req, res) => {
    const { endBreak } = req.body;
    const userId = req.user._id;

    if (!endBreak) {
      return res.status(400).json({ message: 'End break time is required.' });
    }

    try {
      // Find the payroll entry for the day that has no end time
      const payroll = await Payroll.findOne({ userId, endTime: null });
      if (!payroll) {
        return res
          .status(404)
          .json({ message: 'Start time not logged for today.' });
      }

      if (!payroll.startBreak) {
        return res
          .status(400)
          .json({ message: 'Break start time not logged. Please start a break first.' });
      }

      const endBreakTime = new Date(endBreak);
      const startBreakTime = payroll.startBreak;

      if (endBreakTime <= startBreakTime) {
        return res
          .status(400)
          .json({ message: 'Break end time must be after break start time.' });
      }

      // Calculate break duration in hours
      const breakDuration = (endBreakTime - startBreakTime) / (1000 * 3600);

      // Add to existing total break time if any
      payroll.endBreak = endBreakTime;
      payroll.totalBreak = (payroll.totalBreak || 0) + breakDuration;

      await payroll.save();

      res.status(200).json({
        message: 'Break end time logged successfully.',
        payroll,
        breakDuration: breakDuration.toFixed(2),
      });
    } catch (error) {
      console.error('Error logging break end time:', error);
      res
        .status(500)
        .json({ message: 'Failed to log break end time.', error: error.message });
    }
  },

  logEndTime: async (req, res) => {
    const { endTime } = req.body;
    const userId = req.user._id;

    if (!endTime) {
      return res.status(400).json({ message: 'End time is required.' });
    }

    try {
      // Find the payroll entry for the day that has no end time
      const payroll = await Payroll.findOne({ userId, endTime: null });
      if (!payroll) {
        return res
          .status(404)
          .json({ message: 'Start time not logged for today.' });
      }

      const end = new Date(endTime);
      const start = payroll.startTime;

      if (end <= start) {
        return res
          .status(400)
          .json({ message: 'End time must be after start time.' });
      }

      const totalHoursWorked = (end - start) / (1000 * 3600); // Convert milliseconds to hours

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found.' });
      }

      // If payroll has been reset, initialize new values
      // if (user.payrollReset) {
      //   user.totalHoursWorked = 0;
      //   user.totalSalary = 0;
      //   user.payrollReset = false; // Unset the reset flag
      // }

      const REGULAR_HOURS_LIMIT = user.regularHours; // 8 hours per day

      // Calculate regular and overtime hours
      let regularHours = totalHoursWorked;
      let overtimeHours = 0;
      let totalSalary = 0;

      if (totalHoursWorked <= REGULAR_HOURS_LIMIT) {
        // If driver works <= regular hours, get the day price (flat rate)
        regularHours = totalHoursWorked;
        overtimeHours = 0;
        totalSalary = user.hourPrice; // dayPrice (flat rate)
      } else {
        // If driver works > regular hours, get day price + extra hours * extra hour price
        regularHours = REGULAR_HOURS_LIMIT;
        overtimeHours = totalHoursWorked - REGULAR_HOURS_LIMIT;
        const dayPrice = user.hourPrice; // dayPrice (regular hours rate becomes day rate)
        const overtimeSalary = overtimeHours * user.extraHourPrice;
        totalSalary = dayPrice + overtimeSalary;
      }

      // Get today's tasks and expenses for the user
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      // Get all tasks for today where the user received cash
      // Match by userId stored in cashReceivedBy
      const tasks = await Task.find({
        date: { $gte: today, $lt: tomorrow },
        cashReceivedBy: userId,
      });

      // Calculate total cash received from tasks
      const totalCash = tasks.reduce((sum, task) => sum + (task.cashReceived || 0), 0);

      // Calculate total expenses directly from Expense documents for this driver and date
      let totalExpenses = 0;
      const expenses = await Expense.find({
        driverId: userId,
        addedBy: user.username,
        date: { $gte: today, $lt: tomorrow }
      });
      totalExpenses = expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0);

      // Calculate PCN/Damages deductions for this user by PCN creation date + user
      const pcnDamages = await PcnDamage.find({
        createdAt: { $gte: today, $lt: tomorrow },
        deductedFromUserId: userId
      });
      const totalPcnDamages = pcnDamages.reduce((sum, pcn) => sum + (pcn.amount || 0), 0);

      payroll.endTime = end;
      payroll.totalHoursWorked = totalHoursWorked;
      payroll.regularHours = regularHours;
      payroll.extraHours = overtimeHours;
      payroll.totalSalary = totalSalary;
      payroll.totalExpenses = totalExpenses;
      payroll.totalPcnDamages = totalPcnDamages;
      payroll.totalCash = totalCash;

      // Update the user's total hours worked and total salary
      user.totalHoursWorked += totalHoursWorked;
      user.totalSalary += payroll.totalSalary;

      await payroll.save();
      await user.save(); // Save updated user totals

      res.status(200).json({
        message: 'End time logged and salary calculated successfully.',
        payroll,
      });
    } catch (error) {
      console.error('Error logging end time:', error);
      res
        .status(500)
        .json({ message: 'Failed to log end time.', error: error.message });
    }
  },

  // Get all payroll records for the logged-in user
  getIndividualPayrollRecords: async (req, res) => {
    const userId = req.user._id;

    try {
      const payrolls = await Payroll.find({ userId }).sort({ startTime: -1 });
      if (!payrolls || payrolls.length === 0) {
        return res
          .status(404)
          .json({ message: 'No payroll records found for this user.' });
      }

      res.status(200).json(payrolls);
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve payroll records.',
        error: error.message,
      });
    }
  },

  updatePayrollRecord: async (req, res) => {
    const { startTime, endTime, startBreak, endBreak, totalBreak, notes } = req.body;
    const userId = req.user._id; // Get user ID from authenticated user
    const { payrollId } = req.params; // Get payroll ID from request parameters

    try {
      // Find payroll record by payroll ID and ensure it belongs to the logged-in user
      const payroll = await Payroll.findOne({ _id: payrollId, userId });
      if (!payroll) {
        return res
          .status(404)
          .json({ message: 'Payroll record not found or not yours.' });
      }

      // Update startTime and endTime if provided
      if (startTime) payroll.startTime = new Date(startTime);
      if (endTime) payroll.endTime = new Date(endTime);

      // Update break fields if provided
      if (startBreak) payroll.startBreak = new Date(startBreak);
      if (endBreak) payroll.endBreak = new Date(endBreak);
      if (totalBreak !== undefined) payroll.totalBreak = totalBreak;
      if (notes) payroll.notes = notes;
      // Recalculate hours worked and salary
      const hoursWorked =
        (new Date(payroll.endTime) - new Date(payroll.startTime)) /
        (1000 * 3600);
      payroll.totalHoursWorked = hoursWorked;
      payroll.totalSalary =
        hoursWorked * (await User.findById(userId)).hourPrice;

      await payroll.save();

      res.status(200).json({
        message: 'Payroll record updated successfully.',
        payroll,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update payroll record.',
        error: error.message,
      });
    }
  },

  getTotalWorkedHoursAndSalaryForUser: async (req, res) => {
    const userId = req.user._id;

    try {
      // Fetch user details
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({ message: 'User not found.' });
      }

      // Return total hours worked and total salary even after reset
      res.status(200).json({
        userId,
        totalHoursWorked: user.totalHoursWorked, // Fetch from the user model
        totalSalary: user.totalSalary, // Fetch from the user model
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve total salary and hours worked.',
        error: error.message,
      });
    }
  },
  getAllWorkedHoursAndSalaryForAllUsers: async (req, res) => {
    try {
      // Fetch all users
      const users = await User.find({});

      if (!users || users.length === 0) {
        return res.status(404).json({ message: 'No users found.' });
      }

      // Prepare response object to store total worked hours and salary for each user
      const userPayrolls = users.map((user) => ({
        userId: user._id,
        username: user.username, // Include the username for easy identification
        totalHoursWorked: user.totalHoursWorked, // Fetch from user model
        totalSalary: user.totalSalary, // Fetch from user model
      }));

      res.status(200).json(userPayrolls);
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve worked hours and salary for all users.',
        error: error.message,
      });
    }
  },

  resetPayroll: async (req, res) => {
    const { userId } = req.params;

    try {
      // Reset the payroll for future calculations but don't erase old payroll records
      await User.findByIdAndUpdate(userId, {

        totalHoursWorked: 0, // Reset the counters for future calculations
        totalSalary: 0,
      });

      res.status(200).json({
        message: 'Payroll reset successfully for future calculations.',
      });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to reset payroll.', error: error.message });
    }
  },

  // Admin - Get all payroll records for all users
  getAllPayrolls: async (req, res) => {
    try {
      const { page = 1, limit = 10, keyword } = req.query;
      let filters = req.query.filters;

      // Parse filters if they are in JSON string format
      filters =
        typeof filters === 'string' ? JSON.parse(filters) : filters || [];

      // Initialize the main query object
      let payrollQuery = {};

      //Extract Date Range from Filters
      const startTimeFilter = filters.find(
        (filter) => filter.name === 'startTime',
      );
      const endTimeFilter = filters.find((filter) => filter.name === 'endTime');

      if (startTimeFilter && endTimeFilter) {
        payrollQuery.$or = [
          {
            startTime: {
              $gte: new Date(startTimeFilter.id),
              $lte: new Date(endTimeFilter.id),
            },
          },
          {
            endTime: {
              $gte: new Date(startTimeFilter.id),
              $lte: new Date(endTimeFilter.id),
            },
          },
        ];
      }
      // Handle keyword search for usernames
      let userIds = [];
      if (keyword) {
        const users = await User.find(
          { username: { $regex: keyword, $options: 'i' } },
          '_id',
        );
        userIds = users.map((user) => user._id);

        // If no matching users are found, return early with an empty result
        if (userIds.length === 0) {
          return res.status(200).json({
            message: 'No data found',
            payrolls: [],
            meta: {
              currentPage: parseInt(page, 10),
              limit: parseInt(limit, 10),
              total: 0,
              count: 0,
            },
          });
        }
      }

      // Add user ID filter to the payroll query if userIds were found
      if (userIds.length > 0) {
        payrollQuery.userId = { $in: userIds };
      }

      // Execute the Payroll query with populated user details
      let payrollRecordsQuery = Payroll.find(payrollQuery).populate({
        path: 'userId',
        select: 'username email roleType',
      })
        .populate({
          path: 'truckId',
          select: 'name',
        });

      // Pagination
      const total = await Payroll.countDocuments(payrollQuery);
      payrollRecordsQuery = payrollRecordsQuery
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const payrolls = await payrollRecordsQuery.exec();

      res.status(200).json({
        message: 'Payroll records retrieved successfully',
        payrolls,
        meta: {
          currentPage: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total,
          count: payrolls.length,
        },
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve payroll records.',
        error: error.message,
      });
    }
  },

  // Admin - Get payroll records for a specific user
  getPayrollsByUserId: async (req, res) => {
    const { userId } = req.params;
    const { startDate, endDate } = req.query;

    try {
      const query = { userId: userId };
      if (startDate && endDate) {
        query.startTime = { $gte: new Date(startDate), $lte: new Date(endDate) };
      }
      const payrolls = await Payroll.find(query).populate('userId', 'username email roleType truckId');
      if (!payrolls || payrolls.length === 0) {
        return res
          .status(404)
          .json({ message: 'No payroll records found for this user.' });
      }

      res.status(200).json(payrolls);
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve payroll records for user.',
        error: error.message,
      });
    }
  },

  // Admin - Update a payroll record for a user
  updatePayrollAdmin: async (req, res) => {
    const { startTime, endTime, startBreak, endBreak, totalBreak, regularHours, extraHours, totalExpenses, totalPcnDamages, totalCash, status, notes } = req.body;
    const { payrollId } = req.params;

    try {
      const payroll = await Payroll.findById(payrollId);
      if (!payroll) {
        return res.status(404).json({ message: 'Payroll record not found.' });
      }

      // Update basic time fields if provided
      if (startTime) payroll.startTime = new Date(startTime);
      if (endTime) payroll.endTime = new Date(endTime);

      // Update break fields if provided
      if (startBreak) payroll.startBreak = new Date(startBreak);
      if (endBreak) payroll.endBreak = new Date(endBreak);
      if (totalBreak !== undefined) payroll.totalBreak = totalBreak;
      if (notes) payroll.notes = notes;
      // Validate time order if both times are provided
      if (startTime && endTime && new Date(endTime) <= new Date(startTime)) {
        return res.status(400).json({ message: 'End time must be after start time.' });
      }

      // Calculate hours worked if both times are provided
      if (startTime && endTime) {
        const hoursWorked = (new Date(endTime) - new Date(startTime)) / (1000 * 3600);
        payroll.totalHoursWorked = hoursWorked;
      }

      // Update hours if provided
      if (regularHours !== undefined) payroll.regularHours = regularHours;
      if (extraHours !== undefined) payroll.extraHours = extraHours;

      // Update financial fields if provided
      if (totalExpenses !== undefined) payroll.totalExpenses = totalExpenses;
      if (totalCash !== undefined) payroll.totalCash = totalCash;

      // Calculate salary based on hours and user's rates
      const user = await User.findById(payroll.userId);
      if (!user) {
        return res.status(404).json({ message: 'Associated user not found.' });
      }

      // Calculate total salary based on regular and extra hours
      const regularSalary = (payroll.regularHours || 0) * user.hourPrice;
      const extraSalary = (payroll.extraHours || 0) * user.extraHourPrice;
      payroll.totalSalary = regularSalary + extraSalary;

      // Update totalPcnDamages: use provided value if manually set, otherwise calculate from daily sheet
      if (totalPcnDamages !== undefined) {
        // Use the manually provided value (admin override)
        payroll.totalPcnDamages = totalPcnDamages;
      } else if (payroll.startTime) {
        // Calculate from PcnDamage by creation date + user
        const payrollDate = new Date(payroll.startTime);
        payrollDate.setHours(0, 0, 0, 0);
        const nextDay = new Date(payrollDate);
        nextDay.setDate(payrollDate.getDate() + 1);

        const pcnDamages = await PcnDamage.find({
          createdAt: { $gte: payrollDate, $lt: nextDay },
          deductedFromUserId: payroll.userId
        });
        payroll.totalPcnDamages = pcnDamages.reduce((sum, pcn) => sum + (pcn.amount || 0), 0);
      }

      // Update status if provided
      if (status && ['Pending', 'Paid'].includes(status)) {
        payroll.status = status;
      }

      await payroll.save();

      res.status(200).json({
        message: 'Payroll updated successfully.',
        payroll
      });
    } catch (error) {
      console.error('Error updating payroll:', error);
      res.status(500).json({
        message: 'Failed to update payroll.',
        error: error.message
      });
    }
  },

  // Admin - Create a payroll record for a user
  createPayrollAdmin: async (req, res) => {
    const {
      userId,
      startTime,
      endTime,
      startBreak,
      endBreak,
      totalBreak,
      truckId,
      regularHours,
      extraHours,
      totalExpenses,
      totalPcnDamages,
      totalCash,
      status,
      notes
    } = req.body;

    try {
      // Validate required fields
      if (!userId) {
        return res.status(400).json({ message: 'User ID is required.' });
      }

      // Validate user exists
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found.' });
      }

      // Validate time order if both times are provided
      if (startTime && endTime && new Date(endTime) <= new Date(startTime)) {
        return res.status(400).json({ message: 'End time must be after start time.' });
      }

      // Validate break time order if both break times are provided
      if (startBreak && endBreak && new Date(endBreak) <= new Date(startBreak)) {
        return res.status(400).json({ message: 'Break end time must be after break start time.' });
      }

      // Calculate hours worked if both startTime and endTime are provided
      let calculatedTotalHours = 0;
      let calculatedRegularHours = 0;
      let calculatedExtraHours = 0;

      if (startTime && endTime) {
        calculatedTotalHours = (new Date(endTime) - new Date(startTime)) / (1000 * 3600);

        const REGULAR_HOURS_LIMIT = user.regularHours || 8;

        if (calculatedTotalHours <= REGULAR_HOURS_LIMIT) {
          calculatedRegularHours = calculatedTotalHours;
          calculatedExtraHours = 0;
        } else {
          calculatedRegularHours = REGULAR_HOURS_LIMIT;
          calculatedExtraHours = calculatedTotalHours - REGULAR_HOURS_LIMIT;
        }
      }

      // Use provided values or calculated values
      const finalTotalHours = calculatedTotalHours || 0;
      const finalRegularHours = regularHours !== undefined ? regularHours : calculatedRegularHours;
      const finalExtraHours = extraHours !== undefined ? extraHours : calculatedExtraHours;

      // Calculate salary based on user's rates
      // Using the same logic as updatePayrollAdmin: hourly rate for regular hours + extra hour price for extra hours
      const regularSalary = user.hourPrice;
      const extraSalary = finalExtraHours * user.extraHourPrice;
      const calculatedSalary = regularSalary + extraSalary;

      // Optionally calculate totalCash, totalExpenses, and totalPcnDamages if date is provided
      let calculatedTotalCash = totalCash !== undefined ? totalCash : 0;
      let calculatedTotalExpenses = totalExpenses !== undefined ? totalExpenses : 0;
      let calculatedTotalPcnDamages = totalPcnDamages !== undefined ? totalPcnDamages : 0;

      // Calculate from daily sheet if startTime is provided and values not manually set
      if (startTime) {
        // Get the date from startTime
        const payrollDate = new Date(startTime);
        payrollDate.setHours(0, 0, 0, 0);
        const nextDay = new Date(payrollDate);
        nextDay.setDate(payrollDate.getDate() + 1);

        // Get all tasks for the date where the user received cash (by userId)
        const tasks = await Task.find({
          date: { $gte: payrollDate, $lt: nextDay },
          cashReceivedBy: userId,
        });

        // Calculate total cash received from tasks (use provided value if specified, otherwise calculate)
        if (totalCash === undefined) {
          calculatedTotalCash = tasks.reduce((sum, task) => sum + (task.cashReceived || 0), 0);
        }

        // Calculate total expenses (use provided value if specified, otherwise calculate from Expense documents)
        if (totalExpenses === undefined) {
          const expenses = await Expense.find({
            driverId: userId,
            addedBy: user.username,
            date: { $gte: payrollDate, $lt: nextDay }
          });
          calculatedTotalExpenses = expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0);
        }

        // Calculate totalPcnDamages from PcnDamage by creation date + user
        if (totalPcnDamages === undefined) {
          const pcnDamages = await PcnDamage.find({
            createdAt: { $gte: payrollDate, $lt: nextDay },
            deductedFromUserId: userId
          });
          calculatedTotalPcnDamages = pcnDamages.reduce((sum, pcn) => sum + (pcn.amount || 0), 0);
        }
      }

      // Get truckId if not provided but user has a truck
      let finalTruckId = truckId;
      if (!finalTruckId) {
        const truck = await Truck.findOne({ driverId: userId }) || await Truck.findOne({ helperId: userId });
        if (truck) {
          finalTruckId = truck._id;
        }
      }

      // Create new payroll record
      const newPayroll = new Payroll({
        userId,
        startTime: startTime ? new Date(startTime) : undefined,
        endTime: endTime ? new Date(endTime) : undefined,
        startBreak: startBreak ? new Date(startBreak) : undefined,
        endBreak: endBreak ? new Date(endBreak) : undefined,
        totalBreak: totalBreak !== undefined ? totalBreak : 0,
        truckId: finalTruckId,
        totalHoursWorked: finalTotalHours,
        regularHours: finalRegularHours,
        extraHours: finalExtraHours,
        totalSalary: calculatedSalary,
        totalExpenses: calculatedTotalExpenses,
        totalPcnDamages: calculatedTotalPcnDamages,
        totalCash: calculatedTotalCash,
        status: status && ['Pending', 'Paid'].includes(status) ? status : 'Pending',
        notes: notes || undefined,
      });

      await newPayroll.save();

      // Populate user and truck details for response
      await newPayroll.populate({
        path: 'userId',
        select: 'username email roleType'
      });
      await newPayroll.populate({
        path: 'truckId',
        select: 'name'
      });

      res.status(201).json({
        message: 'Payroll record created successfully.',
        payroll: newPayroll
      });
    } catch (error) {
      console.error('Error creating payroll:', error);
      res.status(500).json({
        message: 'Failed to create payroll record.',
        error: error.message
      });
    }
  },

  // Admin - Delete a payroll record for a user
  deletePayroll: async (req, res) => {
    const { payrollId } = req.params;

    try {
      const payroll = await Payroll.findByIdAndDelete(payrollId);
      if (!payroll) {
        return res.status(404).json({ message: 'Payroll record not found.' });
      }

      res.status(200).json({ message: 'Payroll record deleted successfully.' });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to delete payroll record.',
        error: error.message,
      });
    }
  },
  markPayrollAsPaid: async (req, res) => {
    try {
      // Find the payroll by ID
      const payrollId = req.params.payrollId;
      console.log(payrollId);
      const payroll = await Payroll.findById(payrollId);

      if (!payroll) throw new Error('Payroll not found');

      // Check if the payroll is already marked as paid
      if (payroll.status === 'paid') {
        throw new Error('Payroll is already marked as paid');
      }

      // Recalculate hours worked and salary before marking as paid
      const totalHoursWorked =
        (new Date(payroll.endTime) - new Date(payroll.startTime)) /
        (1000 * 3600);
      const regularHours = Math.min(totalHoursWorked, 8);
      const extraHours = Math.max(totalHoursWorked - 8, 0);

      // Fetch user to get the hourly rate
      const user = await User.findById(payroll.userId);
      if (!user) throw new Error('User not found');

      // Calculate salary
      const totalSalary =
        regularHours * user.hourPrice + extraHours * user.hourPrice * 1.5;

      // Deduct hours and salary from user's total
      user.totalHoursWorked = (user.totalHoursWorked || 0) - totalHoursWorked;
      user.totalSalary = (user.totalSalary || 0) - totalSalary;

      // Mark payroll as paid
      payroll.status = 'Paid';

      // Save updated payroll and user
      await payroll.save();
      await user.save();

      res
        .status(200)
        .json({ message: 'Payroll record marked as paid successfully.' });
    } catch (error) {
      console.error(`Error marking payroll as paid: ${error.message}`);
      res
        .status(500)
        .json({ error: `Error marking payroll as paid: ${error.message}` });
    }
  },
  getTopExtraHoursThisWeek: async (req, res) => {
    try {
      // Calculate current week's Monday to Sunday range
      const now = new Date();
      const day = now.getDay(); // 0 (Sun) to 6 (Sat)
      const diffToMonday = day === 0 ? -6 : 1 - day;

      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() + diffToMonday);
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      const topStaff = await Payroll.aggregate([
        {
          $match: {
            startTime: { $gte: startOfWeek, $lte: endOfWeek },
          },
        },
        {
          $group: {
            _id: "$userId",
            totalExtraHours: { $sum: "$extraHours" },
          },
        },
        {
          $sort: { totalExtraHours: -1 },
        },
        {
          $limit: 10, // Change this if you want top 5, etc.
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user",
          },
        },
        {
          $unwind: "$user",
        },
        {
          $project: {
            _id: 0,
            username: "$user.username",
            totalExtraHours: 1,
          },
        },
      ]);

      res.status(200).json({
        message: "Top staff with extra hours this week",
        staff: topStaff,
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to retrieve top extra hours staff",
        error: error.message,
      });
    }
  },
  getTopExtraHoursThisMonth: async (req, res) => {
    try {
      const { from, to } = req.query;
      let startOfRange;
      let endOfRange;

      if (from && to) {
        // Last month (or custom range): use provided from/to
        startOfRange = new Date(from);
        startOfRange.setHours(0, 0, 0, 0);
        endOfRange = new Date(to);
        endOfRange.setHours(23, 59, 59, 999);
      } else {
        // This month: current month
        const now = new Date();
        startOfRange = new Date(now.getFullYear(), now.getMonth(), 1);
        startOfRange.setHours(0, 0, 0, 0);
        endOfRange = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        endOfRange.setHours(23, 59, 59, 999);
      }

      const topStaff = await Payroll.aggregate([
        {
          $match: {
            startTime: { $gte: startOfRange, $lte: endOfRange },
          },
        },
        {
          $group: {
            _id: "$userId",
            totalExtraHours: { $sum: "$extraHours" },
          },
        },
        { $sort: { totalExtraHours: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: "$user" },
        {
          $project: {
            _id: 0,
            username: "$user.username",
            totalExtraHours: 1,
          },
        },
      ]);

      res.status(200).json({
        message: "Top staff with extra hours this month",
        staff: topStaff,
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to retrieve top extra hours staff for this month",
        error: error.message,
      });
    }
  },

  /**
   * Recalculate totalCash for all payroll records of a given user on a given date.
   * Call when a task's cash (cashReceived / cashReceivedBy) is set or changed.
   */
  recalculatePayrollTotalCash: async (date, userId) => {
    try {
      if (!userId) return;
      const parsed = new Date(date);
      if (isNaN(parsed.getTime())) {
        console.error('recalculatePayrollTotalCash: invalid date', date);
        return;
      }
      const y = parsed.getFullYear();
      const m = parsed.getMonth();
      const d = parsed.getDate();
      const startDate = new Date(y, m, d, 0, 0, 0, 0);
      const endDate = new Date(y, m, d, 23, 59, 59, 999);

      const payrollRecords = await Payroll.find({
        userId,
        startTime: { $gte: startDate, $lte: endDate },
      });

      if (payrollRecords.length === 0) {
        console.log(
          '[Payroll] recalculatePayrollTotalCash: no payroll records for user',
          String(userId),
          'on',
          startDate.toISOString().slice(0, 10),
        );
        return;
      }

      const tasks = await Task.find({
        date: { $gte: startDate, $lte: endDate },
        cashReceivedBy: userId,
      });
      const totalCash = tasks.reduce((sum, task) => sum + (task.cashReceived || 0), 0);

      for (const payroll of payrollRecords) {
        const before = payroll.totalCash || 0;
        payroll.totalCash = totalCash;
        await payroll.save();
        console.log(
          '[Payroll] totalCash updated for payroll',
          payroll._id.toString(),
          'user',
          String(userId),
          'date',
          startDate.toISOString().slice(0, 10),
          'from',
          before,
          'to',
          totalCash,
        );
      }
    } catch (error) {
      console.error('Error recalculating payroll totalCash:', error);
    }
  },

};

module.exports = PayrollCtrl;
