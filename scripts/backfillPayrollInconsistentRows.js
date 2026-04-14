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

function calcExpectedHoursAndSalary(payroll, user) {
  const totalHoursWorked = round2(
    (new Date(payroll.endTime) - new Date(payroll.startTime)) / (1000 * 3600),
  );
  const regularHoursLimit = user.regularHours || 8;
  const regularHours = round2(Math.min(totalHoursWorked, regularHoursLimit));
  const extraHours = round2(Math.max(totalHoursWorked - regularHoursLimit, 0));
  const totalSalary = round2((user.hourPrice || 0) + (extraHours * (user.extraHourPrice || 0)));

  return {
    totalHoursWorked,
    regularHours,
    extraHours,
    totalSalary,
  };
}

async function calcExpectedFinancials(userId, startTime) {
  const { start, end } = dayRangeFromDate(startTime);
  const [tasks, expenses, pcnDamages] = await Promise.all([
    Task.find({
      date: { $gte: start, $lte: end },
      cashReceivedBy: userId,
    }).select('cashReceived'),
    Expense.find({
      driverId: userId,
      $or: [{ date: { $gte: start, $lte: end } }, { time: { $gte: start, $lte: end } }],
    }).select('amount'),
    PcnDamage.find({
      deductedFromUserId: userId,
      createdAt: { $gte: start, $lte: end },
    }).select('amount'),
  ]);

  return {
    totalCash: round2(tasks.reduce((sum, task) => sum + (task.cashReceived || 0), 0)),
    totalExpenses: round2(expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0)),
    totalPcnDamages: round2(pcnDamages.reduce((sum, pcn) => sum + (pcn.amount || 0), 0)),
  };
}

function hasMismatch(payroll, expected) {
  return (
    round2(payroll.totalHoursWorked || 0) !== expected.totalHoursWorked ||
    round2(payroll.regularHours || 0) !== expected.regularHours ||
    round2(payroll.extraHours || 0) !== expected.extraHours ||
    round2(payroll.totalSalary || 0) !== expected.totalSalary ||
    round2(payroll.totalCash || 0) !== expected.totalCash ||
    round2(payroll.totalExpenses || 0) !== expected.totalExpenses ||
    round2(payroll.totalPcnDamages || 0) !== expected.totalPcnDamages
  );
}

async function backfillPayrollInconsistentRows({ dryRun = false } = {}) {
  console.log(`Starting payroll inconsistency backfill${dryRun ? ' [DRY RUN]' : ''}...`);

  // Focus on records with both times set, where broken rows usually happen.
  const query = {
    startTime: { $exists: true, $ne: null },
    endTime: { $exists: true, $ne: null },
  };
  const totalPayrolls = await Payroll.countDocuments(query);
  console.log(`Payroll records to scan: ${totalPayrolls}`);

  let scanned = 0;
  let fixed = 0;
  let unchanged = 0;
  let skipped = 0;

  const userCache = new Map();

  const cursor = Payroll.find(query)
    .select(
      '_id userId startTime endTime totalHoursWorked regularHours extraHours totalSalary totalCash totalExpenses totalPcnDamages',
    )
    .cursor();

  for (let payroll = await cursor.next(); payroll != null; payroll = await cursor.next()) {
    scanned += 1;

    if (new Date(payroll.endTime) <= new Date(payroll.startTime)) {
      skipped += 1;
      continue;
    }

    const userId = payroll.userId ? payroll.userId.toString() : null;
    if (!userId) {
      skipped += 1;
      continue;
    }

    let user = userCache.get(userId);
    if (!user) {
      // eslint-disable-next-line no-await-in-loop
      user = await User.findById(userId).select('_id username hourPrice extraHourPrice regularHours');
      if (!user) {
        skipped += 1;
        continue;
      }
      userCache.set(userId, user);
    }

    // eslint-disable-next-line no-await-in-loop
    const expectedHoursSalary = calcExpectedHoursAndSalary(payroll, user);
    // eslint-disable-next-line no-await-in-loop
    const expectedFinancials = await calcExpectedFinancials(payroll.userId, payroll.startTime);
    const expected = { ...expectedHoursSalary, ...expectedFinancials };

    if (!hasMismatch(payroll, expected)) {
      unchanged += 1;
      continue;
    }

    fixed += 1;
    const dateLabel = new Date(payroll.startTime).toISOString().slice(0, 10);
    console.log(
      `[${dryRun ? 'would-fix' : 'fix'}] payroll=${payroll._id} user=${user.username} date=${dateLabel} hours ${round2(
        payroll.totalHoursWorked || 0,
      )} -> ${expected.totalHoursWorked}`,
    );

    if (!dryRun) {
      payroll.totalHoursWorked = expected.totalHoursWorked;
      payroll.regularHours = expected.regularHours;
      payroll.extraHours = expected.extraHours;
      payroll.totalSalary = expected.totalSalary;
      payroll.totalCash = expected.totalCash;
      payroll.totalExpenses = expected.totalExpenses;
      payroll.totalPcnDamages = expected.totalPcnDamages;
      // eslint-disable-next-line no-await-in-loop
      await payroll.save();
    }

    if (scanned % 200 === 0) {
      console.log(
        `processed ${scanned}/${totalPayrolls} | fixed=${fixed} | unchanged=${unchanged} | skipped=${skipped}`,
      );
    }
  }

  console.log('Backfill completed');
  console.log(`Scanned: ${scanned}`);
  console.log(`Fixed: ${fixed}${dryRun ? ' (would fix)' : ''}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log(`Skipped: ${skipped}`);
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');

  try {
    await connectToDatabase();
    console.log('MongoDB connected');
    await backfillPayrollInconsistentRows({ dryRun });
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Backfill failed:', error);
    try {
      await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
  }
}

if (require.main === module) run();

module.exports = { backfillPayrollInconsistentRows };
