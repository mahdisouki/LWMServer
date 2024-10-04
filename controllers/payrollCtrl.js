const { User } = require('../models/User');
const Payroll = require('../models/Payroll');

const PayrollCtrl = {

    // Log start time at the beginning of the day
    logStartTime: async (req, res) => {
        const { startTime } = req.body;
        const userId = req.user._id;

        if (!startTime) {
            return res.status(400).json({ message: "Start time is required." });
        }

        try {
            // Check if there is already a payroll entry for today with no end time
            const existingPayroll = await Payroll.findOne({ userId, endTime: null });

            if (existingPayroll) {
                return res.status(400).json({ message: "You have already started work for the day." });
            }

            // Create a new payroll record with the start time
            const newPayroll = new Payroll({
                userId,
                startTime: new Date(startTime)
            });

            await newPayroll.save();

            res.status(201).json({
                message: "Start time logged successfully.",
                payroll: newPayroll
            });
        } catch (error) {
            res.status(500).json({ message: "Failed to log start time.", error: error.message });
        }
    },

    logEndTime: async (req, res) => {
        const { endTime } = req.body;
        const userId = req.user._id;
    
        if (!endTime) {
            return res.status(400).json({ message: "End time is required." });
        }
    
        try {
            // Find the payroll entry for the day that has no end time
            const payroll = await Payroll.findOne({ userId, endTime: null });
            if (!payroll) {
                return res.status(404).json({ message: "Start time not logged for today." });
            }
    
            const end = new Date(endTime);
            const start = payroll.startTime;
    
            if (end <= start) {
                return res.status(400).json({ message: "End time must be after start time." });
            }
    
            const hoursWorked = (end - start) / (1000 * 3600); // Convert milliseconds to hours
    
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: "User not found." });
            }
    
            // If payroll has been reset, initialize new values
            if (user.payrollReset) {
                user.totalHoursWorked = 0;
                user.totalSalary = 0;
                user.payrollReset = false; // Unset the reset flag
            }
    
            payroll.endTime = end;
            payroll.totalHoursWorked = hoursWorked;
            payroll.totalSalary = hoursWorked * user.hourPrice;
    
            // Update the user's total hours worked and total salary
            user.totalHoursWorked += hoursWorked;
            user.totalSalary += payroll.totalSalary;
    
            await payroll.save();
            await user.save(); // Save updated user totals
    
            res.status(200).json({
                message: "End time logged and salary calculated successfully.",
                payroll
            });
        } catch (error) {
            res.status(500).json({ message: "Failed to log end time.", error: error.message });
        }
    },    

    // Get all payroll records for the logged-in user
    getIndividualPayrollRecords: async (req, res) => {
        const userId = req.user._id;

        try {
            const payrolls = await Payroll.find({ userId }).sort({ startTime: -1 });
            if (!payrolls || payrolls.length === 0) {
                return res.status(404).json({ message: "No payroll records found for this user." });
            }

            res.status(200).json(payrolls);
        } catch (error) {
            res.status(500).json({ message: "Failed to retrieve payroll records.", error: error.message });
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
                return res.status(404).json({ message: "Payroll record not found or not yours." });
            }

            // Update startTime and endTime if provided
            if (startTime) payroll.startTime = new Date(startTime);
            if (endTime) payroll.endTime = new Date(endTime);

            // Recalculate hours worked and salary
            const hoursWorked = (new Date(payroll.endTime) - new Date(payroll.startTime)) / (1000 * 3600);
            payroll.totalHoursWorked = hoursWorked;
            payroll.totalSalary = hoursWorked * (await User.findById(userId)).hourPrice;

            await payroll.save();

            res.status(200).json({
                message: "Payroll record updated successfully.",
                payroll
            });
        } catch (error) {
            res.status(500).json({ message: "Failed to update payroll record.", error: error.message });
        }
    },

    getTotalWorkedHoursAndSalaryForUser: async (req, res) => {
        const userId = req.user._id;
    
        try {
            // Fetch user details
            const user = await User.findById(userId);
    
            if (!user) {
                return res.status(404).json({ message: "User not found." });
            }
    
            // Return total hours worked and total salary even after reset
            res.status(200).json({
                userId,
                totalHoursWorked: user.totalHoursWorked, // Fetch from the user model
                totalSalary: user.totalSalary // Fetch from the user model
            });
        } catch (error) {
            res.status(500).json({ message: "Failed to retrieve total salary and hours worked.", error: error.message });
        }
    },
    getAllWorkedHoursAndSalaryForAllUsers: async (req, res) => {
        try {
            // Fetch all users
            const users = await User.find({});
    
            if (!users || users.length === 0) {
                return res.status(404).json({ message: "No users found." });
            }
    
            // Prepare response object to store total worked hours and salary for each user
            const userPayrolls = users.map(user => ({
                userId: user._id,
                username: user.username, // Include the username for easy identification
                totalHoursWorked: user.totalHoursWorked, // Fetch from user model
                totalSalary: user.totalSalary // Fetch from user model
            }));
    
            res.status(200).json(userPayrolls);
        } catch (error) {
            res.status(500).json({ message: "Failed to retrieve worked hours and salary for all users.", error: error.message });
        }
    },
    
    resetPayroll: async (req, res) => {
        const { userId } = req.params;
    
        try {
            // Reset the payroll for future calculations but don't erase old payroll records
            await User.findByIdAndUpdate(userId, {
                payrollReset: true, // Set the reset flag to true
                totalHoursWorked: 0, // Reset the counters for future calculations
                totalSalary: 0
            });
    
            res.status(200).json({ message: "Payroll reset successfully for future calculations." });
        } catch (error) {
            res.status(500).json({ message: "Failed to reset payroll.", error: error.message });
        }
    },    
    // Admin - Get all payroll records for all users
    getAllPayrolls: async (req, res) => {
        try {
            const payrolls = await Payroll.find({});
            res.status(200).json(payrolls);
        } catch (error) {
            res.status(500).json({ message: "Failed to retrieve payroll records.", error: error.message });
        }
    },

    // Admin - Get payroll records for a specific user
    getPayrollsByUserId: async (req, res) => {
        const { userId } = req.params;

        try {
            const payrolls = await Payroll.find({ userId });
            if (!payrolls || payrolls.length === 0) {
                return res.status(404).json({ message: "No payroll records found for this user." });
            }

            res.status(200).json(payrolls);
        } catch (error) {
            res.status(500).json({ message: "Failed to retrieve payroll records for user.", error: error.message });
        }
    },

    // Admin - Update a payroll record for a user
    updatePayrollAdmin: async (req, res) => {
        const { startTime, endTime } = req.body;
        const { payrollId } = req.params;

        try {
            const payroll = await Payroll.findById(payrollId);
            if (!payroll) {
                return res.status(404).json({ message: "Payroll record not found." });
            }

            if (startTime) payroll.startTime = new Date(startTime);
            if (endTime) payroll.endTime = new Date(endTime);

            const hoursWorked = (new Date(payroll.endTime) - new Date(payroll.startTime)) / (1000 * 3600);
            const user = await User.findById(payroll.userId);
            payroll.totalHoursWorked = hoursWorked;
            payroll.totalSalary = hoursWorked * user.hourPrice;

            await payroll.save();

            res.status(200).json({ message: "Payroll updated successfully.", payroll });
        } catch (error) {
            res.status(500).json({ message: "Failed to update payroll.", error: error.message });
        }
    },

    // Admin - Delete a payroll record for a user
    deletePayroll: async (req, res) => {
        const { payrollId } = req.params;

        try {
            const payroll = await Payroll.findByIdAndDelete(payrollId);
            if (!payroll) {
                return res.status(404).json({ message: "Payroll record not found." });
            }

            res.status(200).json({ message: "Payroll record deleted successfully." });
        } catch (error) {
            res.status(500).json({ message: "Failed to delete payroll record.", error: error.message });
        }
    }
};

module.exports = PayrollCtrl;