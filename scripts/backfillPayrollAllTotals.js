require('dotenv').config();
const mongoose = require('mongoose');
const connectToDatabase = require('../config/db');
const Payroll = require('../models/Payroll');
const Task = require('../models/Task');
const Expense = require('../models/Expense');
const PcnDamage = require('../models/PcnDamage');
const { User } = require('../models/User');

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function dayRangeFromDate(date) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { start, end };
}

function calculateHoursWorked(payroll) {
  if (payroll.startTime && payroll.endTime) {
    return round2((new Date(payroll.endTime) - new Date(payroll.startTime)) / (1000 * 3600));
  }
  if (typeof payroll.totalHoursWorked === 'number' && payroll.totalHoursWorked >= 0) {
    return round2(payroll.totalHoursWorked);
  }
  return 0;
}

function calculateHoursAndSalary(payroll, user) {
  const totalHoursWorked = calculateHoursWorked(payroll);
  const regularHoursLimit = user.regularHours || 8;
  const regularHours = round2(Math.min(totalHoursWorked, regularHoursLimit));
  const extraHours = round2(Math.max(totalHoursWorked - regularHoursLimit, 0));
  const totalSalary = round2((user.hourPrice || 0) + (extraHours * (user.extraHourPrice || 0)));

  return { totalHoursWorked, regularHours, extraHours, totalSalary };
}

async function recalcFinancialTotalsForDay(userId, start, end) {
  const [tasks, expenses, pcnDamages] = await Promise.all([
    Task.find({
      date: { $gte: start, $lte: end },
      cashReceivedBy: userId,
    }).select('cashReceived'),
    Expense.find({
      driverId: userId,
      $or: [
        { date: { $gte: start, $lte: end } },
        { time: { $gte: start, $lte: end } },
      ],
    }).select('amount'),
    PcnDamage.find({
      deductedFromUserId: userId,
      createdAt: { $gte: start, $lte: end },
    }).select('amount'),
  ]);

  const totalCash = round2(tasks.reduce((sum, task) => sum + (task.cashReceived || 0), 0));
  const totalExpenses = round2(expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0));
  const totalPcnDamages = round2(pcnDamages.reduce((sum, pcn) => sum + (pcn.amount || 0), 0));

  return { totalCash, totalExpenses, totalPcnDamages };
}

async function backfillPayrollAllTotals({ dryRun = false } = {}) {
  console.log(`Starting unified payroll backfill${dryRun ? ' [DRY RUN]' : ''}...`);

  const query = { userId: { $exists: true, $ne: null } };
  const totalPayrolls = await Payroll.countDocuments(query);
  console.log(`Payroll records to scan: ${totalPayrolls}`);

  const userCache = new Map();
  const totalsCache = new Map();

  let scanned = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  const cursor = Payroll.find(query)
    .select('_id userId startTime endTime totalHoursWorked regularHours extraHours totalSalary totalCash totalExpenses totalPcnDamages netSalary')
    .cursor();

  for (let payroll = await cursor.next(); payroll != null; payroll = await cursor.next()) {
    scanned += 1;

    const userId = payroll.userId ? payroll.userId.toString() : null;
    if (!userId) {
      skipped += 1;
      continue;
    }

    let user = userCache.get(userId);
    if (!user) {
      // eslint-disable-next-line no-await-in-loop
      user = await User.findById(userId).select('_id hourPrice extraHourPrice regularHours');
      if (!user) {
        skipped += 1;
        continue;
      }
      userCache.set(userId, user);
    }

    const anchorDate = payroll.startTime || payroll.endTime || payroll.createdAt || payroll.updatedAt;
    if (!anchorDate) {
      skipped += 1;
      continue;
    }
    const { start, end } = dayRangeFromDate(anchorDate);
    const totalsKey = `${userId}|${start.toISOString().slice(0, 10)}`;

    let financial = totalsCache.get(totalsKey);
    if (!financial) {
      // eslint-disable-next-line no-await-in-loop
      financial = await recalcFinancialTotalsForDay(payroll.userId, start, end);
      totalsCache.set(totalsKey, financial);
    }

    const calc = calculateHoursAndSalary(payroll, user);
    const netSalary = round2(calc.totalSalary - financial.totalPcnDamages - (financial.totalCash - financial.totalExpenses));

    const hasChange =
      round2(payroll.totalHoursWorked || 0) !== calc.totalHoursWorked ||
      round2(payroll.regularHours || 0) !== calc.regularHours ||
      round2(payroll.extraHours || 0) !== calc.extraHours ||
      round2(payroll.totalSalary || 0) !== calc.totalSalary ||
      round2(payroll.totalCash || 0) !== financial.totalCash ||
      round2(payroll.totalExpenses || 0) !== financial.totalExpenses ||
      round2(payroll.totalPcnDamages || 0) !== financial.totalPcnDamages ||
      round2(payroll.netSalary || 0) !== netSalary;

    if (hasChange) {
      updated += 1;
      if (!dryRun) {
        payroll.totalHoursWorked = calc.totalHoursWorked;
        payroll.regularHours = calc.regularHours;
        payroll.extraHours = calc.extraHours;
        payroll.totalSalary = calc.totalSalary;
        payroll.totalCash = financial.totalCash;
        payroll.totalExpenses = financial.totalExpenses;
        payroll.totalPcnDamages = financial.totalPcnDamages;
        payroll.netSalary = netSalary;
        // eslint-disable-next-line no-await-in-loop
        await payroll.save();
      }
    } else {
      unchanged += 1;
    }

    if (scanned % 200 === 0) {
      console.log(
        `processed ${scanned}/${totalPayrolls} | updated=${updated} | unchanged=${unchanged} | skipped=${skipped}`,
      );
    }
  }

  console.log('Unified backfill completed');
  console.log(`Scanned: ${scanned}`);
  console.log(`Updated: ${updated}${dryRun ? ' (would update)' : ''}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log(`Skipped: ${skipped}`);
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');

  try {
    await connectToDatabase();
    console.log('MongoDB connected');
    await backfillPayrollAllTotals({ dryRun });
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Unified backfill failed:', error);
    try {
      await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
  }
}

if (require.main === module) run();

module.exports = { backfillPayrollAllTotals };
