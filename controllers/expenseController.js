const DailySheet = require('../models/DailySheet');
const Expense = require('../models/Expense');
const Payroll = require('../models/Payroll');

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const toLocalDateStr = (d) => {
    if (!d) return null;
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

const getMonthRange = (date) => {
    const base = new Date(date);
    if (isNaN(base.getTime())) return null;
    const start = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
};

const getDayRange = (date) => {
    const base = new Date(date);
    if (isNaN(base.getTime())) return null;
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
    const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);
    return { start, end };
};

const getExpenseDay = (expense) => expense.date || expense.createdAt;

// Month-scoped routing (aligned with PCN recalc)
const recalculatePayrollExpenses = async (date, userId) => {
    try {
        const parsed = new Date(date);
        if (isNaN(parsed.getTime())) {
            console.error('recalculatePayrollExpenses: invalid date', date);
            return;
        }
        const monthRange = getMonthRange(parsed);
        if (!monthRange) return;

        const [payrollRecords, expenses] = await Promise.all([
            Payroll.find({
                userId,
                startTime: { $gte: monthRange.start, $lte: monthRange.end },
            }).sort({ startTime: 1 }),
            Expense.find({
                driverId: userId,
                date: { $gte: monthRange.start, $lte: monthRange.end },
            }).sort({ date: 1 }).select('_id amount date createdAt'),
        ]);

        if (payrollRecords.length === 0) {
            for (const expense of expenses) {
                const expenseDate = toLocalDateStr(getExpenseDay(expense));
                expense.reimbursementTargetPayrollId = null;
                expense.reimbursementNote = `Expense on ${expenseDate} not assigned to any payroll this month yet.`;
                await expense.save();
            }
            return;
        }

        // Do not touch validated paid months
        if (!payrollRecords.some((p) => p.status !== 'Paid')) {
            return;
        }

        const payrollMap = new Map();
        for (const payroll of payrollRecords) {
            payrollMap.set(payroll._id.toString(), []);
        }

        for (const expense of expenses) {
            const dayRange = getDayRange(getExpenseDay(expense));
            if (!dayRange) continue;

            const sameDayPayrolls = payrollRecords.filter(
                (p) => p.startTime && p.startTime >= dayRange.start && p.startTime <= dayRange.end,
            );

            let targetPayroll = sameDayPayrolls[0] || null;
            let reimbursementNote = '';

            if (!targetPayroll) {
                const prevPayrolls = payrollRecords.filter((p) => p.startTime && p.startTime < dayRange.start);
                const prevPayroll = prevPayrolls.length > 0 ? prevPayrolls[prevPayrolls.length - 1] : null;
                if (prevPayroll) {
                    targetPayroll = prevPayroll;
                    reimbursementNote = `Expense on ${toLocalDateStr(getExpenseDay(expense))} applied to previous payroll ${toLocalDateStr(prevPayroll.startTime)}.`;
                }
            }

            if (!targetPayroll) {
                const nextPayroll = payrollRecords.find((p) => p.startTime && p.startTime > dayRange.end);
                if (nextPayroll) {
                    targetPayroll = nextPayroll;
                    reimbursementNote = `Expense on ${toLocalDateStr(getExpenseDay(expense))} applied to next payroll ${toLocalDateStr(nextPayroll.startTime)}.`;
                }
            }

            if (!targetPayroll) {
                expense.reimbursementTargetPayrollId = null;
                expense.reimbursementNote = `Expense on ${toLocalDateStr(getExpenseDay(expense))} not assigned to any payroll this month yet.`;
                await expense.save();
                continue;
            }

            if (!reimbursementNote) {
                reimbursementNote = `Expense on ${toLocalDateStr(getExpenseDay(expense))} applied on payroll ${toLocalDateStr(targetPayroll.startTime)}.`;
            }

            if (targetPayroll.status === 'Paid') {
                continue;
            }

            expense.reimbursementTargetPayrollId = targetPayroll._id;
            expense.reimbursementNote = reimbursementNote;
            await expense.save();
            payrollMap.get(targetPayroll._id.toString()).push(expense);
        }

        for (const payroll of payrollRecords) {
            if (payroll.status === 'Paid') continue;
            const assigned = payrollMap.get(payroll._id.toString()) || [];
            payroll.expenses = assigned.map((e) => e._id);
            payroll.totalExpenses = round2(assigned.reduce((sum, e) => sum + (e.amount || 0), 0));
            await payroll.save();
        }
    } catch (error) {
        console.error('Error recalculating payroll expenses:', error);
    }
};

const expenseController = {
    getAllExpenses: async (req, res) => {
        try {
            const { driverId, from, to, addedBy, linkedToDailySheet } = req.query;
            const filter = {};

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

            if (linkedToDailySheet !== undefined) {
                const isLinked = linkedToDailySheet === 'true' || linkedToDailySheet === true;
                filter.linkedToDailySheet = isLinked;
            }

            const expenses = await Expense.find(filter)
                .sort({ date: -1, time: -1 })
                .populate('dailySheetId')
                .populate('reimbursementTargetPayrollId', 'startTime status');
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

            if (dailySheetId) {
                linkedDailySheet = await DailySheet.findById(dailySheetId);
            } else if (driverId && date) {
                const startDate = new Date(date);
                startDate.setHours(0, 0, 0, 0);
                const endDate = new Date(date);
                endDate.setHours(23, 59, 59, 999);

                linkedDailySheet = await DailySheet.findOne({
                    driverId,
                    date: { $gte: startDate, $lte: endDate },
                });
            }

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

            if (linkedDailySheet) {
                linkedDailySheet.expenses.push(expense._id);
                await linkedDailySheet.save();
            }

            await recalculatePayrollExpenses(expense.date, expense.driverId);
            const refreshed = await Expense.findById(expense._id);

            res.status(201).json({ message: 'Expense added', expense: refreshed });
        } catch (error) {
            console.error('Error adding expense:', error);
            res.status(500).json({ message: 'Failed to add expense', error: error.message });
        }
    },

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

            if (oldDriverId && oldDate) {
                await recalculatePayrollExpenses(oldDate, oldDriverId);
            }
            await recalculatePayrollExpenses(expense.date, expense.driverId);

            const refreshed = await Expense.findById(expense._id);
            res.status(200).json({ message: 'Expense updated', expense: refreshed });
        } catch (error) {
            console.error('Error updating expense:', error);
            res.status(500).json({ message: 'Failed to update expense', error: error.message });
        }
    },

    deleteExpense: async (req, res) => {
        try {
            const { expenseId } = req.params;

            const expense = await Expense.findByIdAndDelete(expenseId);
            if (!expense) {
                return res.status(404).json({ message: 'Expense not found' });
            }

            await DailySheet.updateOne(
                { _id: expense.dailySheetId },
                { $pull: { expenses: expense._id } }
            );

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
