const { User } = require('../models/User');
const Payroll = require('../models/Payroll');
const APIfeatures = require('../utils/APIFeatures');
const Truck = require('../models/Truck');
const Task = require('../models/Task');
const DailySheet = require('../models/DailySheet');

const PayrollCtrl = {
  // Log start time at the beginning of the day
  logStartTime: async (req, res) => {
    const { startTime } = req.body;
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
      const truck = await Truck.findOne({ driverId: req.user._id })
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
      res
        .status(500)
        .json({ message: 'Failed to log start time.', error: error.message });
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

      if (totalHoursWorked > REGULAR_HOURS_LIMIT) {
        regularHours = REGULAR_HOURS_LIMIT;
        overtimeHours = totalHoursWorked - REGULAR_HOURS_LIMIT;
      }

      // Calculate salary: regular hours + overtime hours
      const regularSalary = regularHours * user.hourPrice;
      const overtimeSalary = overtimeHours * user.extraHourPrice; // 1.5x for overtime

      // Get today's tasks and expenses for the user
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      // Get all tasks for today where the user received cash
      const tasks = await Task.find({
        date: { $gte: today, $lt: tomorrow },
        cashReceivedBy: user.username,
      });

      // Get all expenses for today by this user
      const dailySheet = await DailySheet.findOne({
        driverId: userId,
        date: { $gte: today, $lt: tomorrow }
      });

      // Calculate total cash received from tasks
      const totalCash = tasks.reduce((sum, task) => sum + (task.cashReceived || 0), 0);

      // Calculate total expenses
      const totalExpenses = dailySheet ? dailySheet.expenses.reduce((sum, expense) => {
        if (expense.addedBy === user.username) {
          return sum + expense.amount;
        }
        return sum;
      }, 0) : 0;

      payroll.endTime = end;
      payroll.totalHoursWorked = totalHoursWorked;
      payroll.regularHours = regularHours;
      payroll.extraHours = overtimeHours;
      payroll.totalSalary = regularSalary + overtimeSalary;
      payroll.totalExpenses = totalExpenses;
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
    const { startTime, endTime } = req.body;
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
    const { startTime, endTime, regularHours, extraHours, totalExpenses, totalCash, status } = req.body;
    const { payrollId } = req.params;

    try {
      const payroll = await Payroll.findById(payrollId);
      if (!payroll) {
        return res.status(404).json({ message: 'Payroll record not found.' });
      }

      // Update basic time fields if provided
      if (startTime) payroll.startTime = new Date(startTime);
      if (endTime) payroll.endTime = new Date(endTime);

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

      // Update status if provided
      if (status && ['Pending', 'Paid'].includes(status)) {
        payroll.status = status;
      }

      // Calculate salary based on hours and user's rates
      const user = await User.findById(payroll.userId);
      if (!user) {
        return res.status(404).json({ message: 'Associated user not found.' });
      }

      // Calculate total salary based on regular and extra hours
      const regularSalary = (payroll.regularHours || 0) * user.hourPrice;
      const extraSalary = (payroll.extraHours || 0) * user.extraHourPrice;
      payroll.totalSalary = regularSalary + extraSalary;

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
      const now = new Date();
  
      // First day of the month
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      startOfMonth.setHours(0, 0, 0, 0);
  
      // Last day of the month
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      endOfMonth.setHours(23, 59, 59, 999);
  
      const topStaff = await Payroll.aggregate([
        {
          $match: {
            startTime: { $gte: startOfMonth, $lte: endOfMonth },
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
  
  
};

module.exports = PayrollCtrl;
