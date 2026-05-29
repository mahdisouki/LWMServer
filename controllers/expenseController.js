const DailySheet = require('../models/DailySheet');
const Expense = require('../models/Expense');
const Payroll = require('../models/Payroll');

// Helper: recalculate payroll.totalExpenses for a user on a given date (like PCN recalc)
const recalculatePayrollExpenses = async (date, userId) => {
    try {
        const parsed = new Date(date);
        if (isNaN(parsed.getTime())) {
            console.error('recalculatePayrollExpenses: invalid date', date);
            return;
        }
        const y = parsed.getFullYear();
        const m = parsed.getMonth();
        const d = parsed.getDate();
        const startDate = new Date(y, m, d, 0, 0, 0, 0);
        const endDate = new Date(y, m, d, 23, 59, 59, 999);

        // Find payroll records for this user on this date (startTime within day)
        const payrollRecords = await Payroll.find({
            userId: userId,
            startTime: { $gte: startDate, $lte: endDate }
        });

        if (payrollRecords.length === 0) {
            console.log(`No payroll records found for user ${userId} on date ${date}`);
            return;
        }

        // Sum all expenses for that driver on that date
        const expenses = await Expense.find({
            driverId: userId,
            date: { $gte: startDate, $lte: endDate }
        });
        const totalExpenses = expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0);

        for (const payroll of payrollRecords) {
            payroll.totalExpenses = totalExpenses;
            await payroll.save();
            console.log(`Updated payroll ${payroll._id} with totalExpenses: ${totalExpenses}`);
        }
    } catch (error) {
        console.error('Error recalculating payroll expenses:', error);
        // don't throw – we don't want to fail the main operation
    }
};

const expenseController = {
    // Get all expenses (optionally filter by driverId, date range, or addedBy)
    getAllExpenses: async (req, res) => {
        try {
            const { driverId, from, to, addedBy, linkedToDailySheet } = req.query;
            const filter = {};

            // Filter by date range via Expense.date
            const dateFilter = {};
            if (from) {
                const fromDate = new Date(from);
                fromDate.setHours(0, 0, 0, 0);
                dateFilter.$gte = fromDate;
            }
            if (to) {
                const toDate = new Date(to);
                toDate.setHours(23, 59, 59, 999);
                dateFilter.$lte = toDate;
            }

            if (driverId) {
                filter.driverId = driverId;
            }
            if (Object.keys(dateFilter).length) {
                filter.date = dateFilter;
            }

            if (addedBy) {
                filter.addedBy = addedBy;
            }

            // Filter by linkedToDailySheet (if provided) - same style as PCN logic
            if (linkedToDailySheet !== undefined) {
                const isLinked = linkedToDailySheet === 'true' || linkedToDailySheet === true;
                filter.linkedToDailySheet = isLinked;
            }

            const expenses = await Expense.find(filter).sort({ date: -1, time: -1 }).populate('dailySheetId');
            res.status(200).json({
                message: 'Expenses retrieved successfully',
                count: expenses.length,
                expenses,
            });
        } catch (error) {
            console.error('Error fetching expenses:', error);
            res.status(500).json({ message: 'Failed to fetch expenses', error: error.message });
        }
    },

    // Get expenses for a specific driver and date (like dailySheet-based endpoints)
    getExpensesForDriverAndDate: async (req, res) => {
        try {
            const { driverId, date } = req.params;

            const startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);

            const expenses = await Expense.find({
                driverId,
                date: { $gte: startDate, $lte: endDate },
            }).sort({ date: -1, time: -1 });

            res.status(200).json({
                message: 'Expenses retrieved successfully',
                expenses,
            });
        } catch (error) {
            console.error('Error fetching expenses for driver/date:', error);
            res.status(500).json({ message: 'Failed to fetch expenses', error: error.message });
        }
    },

    // Add a new expense, optionally linking it to a DailySheet
    addExpense: async (req, res) => {
        try {
            const { dailySheetId, driverId, date } = req.body;
            const { reason, amount, location, addedBy } = req.body;

            if (!reason || amount == null) {
                return res.status(400).json({ message: 'Reason and amount are required.' });
            }

            const receiptUrl = req.file ? req.file.path : null;

            let linkedDailySheet = null;
            let resolvedDriverId = driverId;
            let resolvedExpenseDate = date;

            // If a dailySheetId is provided directly, try to link to it
            if (dailySheetId) {
                linkedDailySheet = await DailySheet.findById(dailySheetId);
            } else if (driverId && date) {
                // Otherwise, if driverId + date are provided, try to resolve the sheet
                const startDate = new Date(date);
                startDate.setHours(0, 0, 0, 0);
                const endDate = new Date(date);
                endDate.setHours(23, 59, 59, 999);

                linkedDailySheet = await DailySheet.findOne({
                    driverId,
                    date: { $gte: startDate, $lte: endDate },
                });
            }

            // If linked to a sheet, ensure we have driverId/date for the expense
            if (linkedDailySheet) {
                resolvedDriverId = resolvedDriverId || linkedDailySheet.driverId;
                resolvedExpenseDate = resolvedExpenseDate || linkedDailySheet.date;
            }

            if (!resolvedDriverId) {
                return res.status(400).json({ message: 'driverId is required.' });
            }
            if (!resolvedExpenseDate) {
                return res.status(400).json({ message: 'date is required.' });
            }

            const expenseData = {
                driverId: resolvedDriverId,
                reason,
                amount,
                location,
                receiptUrl,
                addedBy,
                date: new Date(resolvedExpenseDate),
            };

            if (linkedDailySheet) {
                expenseData.dailySheetId = linkedDailySheet._id;
                expenseData.linkedToDailySheet = true;
            }

            const expense = await Expense.create(expenseData);

            // If we found a daily sheet, push the reference
            if (linkedDailySheet) {
                linkedDailySheet.expenses.push(expense._id);
                await linkedDailySheet.save();
            }

            // Recalculate payroll expenses for that driver/date
            await recalculatePayrollExpenses(expense.date, expense.driverId);

            res.status(201).json({ message: 'Expense added', expense });
        } catch (error) {
            console.error('Error adding expense:', error);
            res.status(500).json({ message: 'Failed to add expense', error: error.message });
        }
    },

    // Update an expense by ID
    updateExpense: async (req, res) => {
        try {
            const { expenseId } = req.params;
            const { driverId, date, reason, amount, location, dailySheetId, linkedToDailySheet } = req.body;

            const expense = await Expense.findById(expenseId);
            if (!expense) {
                return res.status(404).json({ message: 'Expense not found' });
            }

            const oldDriverId = expense.driverId;
            const oldDate = expense.date;

            const prevDailySheetId = expense.dailySheetId ? expense.dailySheetId.toString() : null;

            if (driverId !== undefined) expense.driverId = driverId;
            if (date !== undefined) expense.date = new Date(date);
            if (reason !== undefined) expense.reason = reason;
            if (amount !== undefined) expense.amount = amount;
            if (location !== undefined) expense.location = location;
            if (req.file) expense.receiptUrl = req.file.path;

            // Support linking/unlinking to a DailySheet (used by "Add existing" flow)
            // Unlink if explicitly requested, or if dailySheetId is null/empty string.
            const parsedLinkedToDailySheet =
                linkedToDailySheet === undefined
                    ? undefined
                    : (linkedToDailySheet === 'true' || linkedToDailySheet === true);

            const shouldUnlink =
                parsedLinkedToDailySheet === false ||
                dailySheetId === null ||
                dailySheetId === '';

            const shouldLink = !shouldUnlink && dailySheetId !== undefined;

            if (shouldUnlink) {
                if (prevDailySheetId) {
                    await DailySheet.updateOne(
                        { _id: prevDailySheetId },
                        { $pull: { expenses: expense._id } }
                    );
                }
                expense.dailySheetId = undefined;
                expense.linkedToDailySheet = false;
            } else if (shouldLink) {
                const nextDailySheetId = dailySheetId.toString();

                const sheet = await DailySheet.findById(nextDailySheetId).select('_id');
                if (!sheet) {
                    return res.status(404).json({ message: 'Daily sheet not found' });
                }

                if (prevDailySheetId && prevDailySheetId !== nextDailySheetId) {
                    await DailySheet.updateOne(
                        { _id: prevDailySheetId },
                        { $pull: { expenses: expense._id } }
                    );
                }

                await DailySheet.updateOne(
                    { _id: nextDailySheetId },
                    { $addToSet: { expenses: expense._id } }
                );

                expense.dailySheetId = sheet._id;
                expense.linkedToDailySheet =
                    parsedLinkedToDailySheet === undefined ? true : parsedLinkedToDailySheet;
            }

            await expense.save();

            // Recalculate payroll expenses for old/new driver/date if relevant
            if (oldDriverId && oldDate) {
                await recalculatePayrollExpenses(oldDate, oldDriverId);
            }
            await recalculatePayrollExpenses(expense.date, expense.driverId);

            res.status(200).json({ message: 'Expense updated', expense });
        } catch (error) {
            console.error('Error updating expense:', error);
            res.status(500).json({ message: 'Failed to update expense', error: error.message });
        }
    },

    // Delete an expense by ID
    deleteExpense: async (req, res) => {
        try {
            const { expenseId } = req.params;

            const expense = await Expense.findByIdAndDelete(expenseId);
            if (!expense) {
                return res.status(404).json({ message: 'Expense not found' });
            }

            // Also remove reference from DailySheet if present
            await DailySheet.updateOne(
                { _id: expense.dailySheetId },
                { $pull: { expenses: expense._id } }
            );

            // Recalculate payroll expenses for that driver/date
            if (expense.date && expense.driverId) {
                await recalculatePayrollExpenses(expense.date, expense.driverId);
            }

            res.status(200).json({ message: 'Expense deleted' });
        } catch (error) {
            console.error('Error deleting expense:', error);
            res.status(500).json({ message: 'Failed to delete expense', error: error.message });
        }
    },
};

expenseController.recalculatePayrollExpenses = recalculatePayrollExpenses;

module.exports = expenseController;


