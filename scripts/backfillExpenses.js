/**
 * Backfill expense records created without driverId/date (e.g. via daily sheet route)
 * and recalculate payroll.totalExpenses (+ netSalary) for affected driver/day pairs.
 *
 * Usage:
 *   node scripts/backfillExpenses.js              # fix expenses + update payroll
 *   node scripts/backfillExpenses.js --dry-run    # report only, no writes
 *   node scripts/backfillExpenses.js --expenses-only   # fix expense docs only
 *   node scripts/backfillExpenses.js --payroll-only    # recalc payroll from existing expenses
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectToDatabase = require('../config/db');
const Expense = require('../models/Expense');
const DailySheet = require('../models/DailySheet');
const Payroll = require('../models/Payroll');
const { recalculatePayrollExpenses } = require('../controllers/expenseController');

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function dayRangeFromDate(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { start, end };
}

function dayKey(userId, date) {
  const d = new Date(date);
  if (isNaN(d.getTime()) || !userId) return null;
  return `${userId.toString()}|${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function needsExpenseFix(expense) {
  if (!expense.driverId || !expense.date) return true;
  if (expense.dailySheetId && expense.linkedToDailySheet !== true) return true;
  return false;
}

async function loadDailySheet(sheetId, cache) {
  const id = sheetId.toString();
  if (cache.has(id)) return cache.get(id);
  const sheet = await DailySheet.findById(sheetId).select('driverId date');
  cache.set(id, sheet || null);
  return sheet;
}

async function resolveExpenseFields(expense, dailySheetCache) {
  let driverId = expense.driverId || null;
  let date = expense.date ? new Date(expense.date) : null;
  let linkedToDailySheet = expense.linkedToDailySheet === true;

  if (expense.dailySheetId) {
    const sheet = await loadDailySheet(expense.dailySheetId, dailySheetCache);
    if (sheet) {
      if (!driverId) driverId = sheet.driverId;
      if (!date && sheet.date) date = new Date(sheet.date);
      linkedToDailySheet = true;
    }
  }

  if (!date && expense.time) date = new Date(expense.time);
  if (!date && expense.createdAt) date = new Date(expense.createdAt);

  return { driverId, date, linkedToDailySheet };
}

async function backfillExpenseDocuments({ dryRun = false } = {}) {
  console.log(`Phase 1: backfill expense fields${dryRun ? ' [DRY RUN]' : ''}...`);

  const query = {
    $or: [
      { driverId: { $exists: false } },
      { driverId: null },
      { date: { $exists: false } },
      { date: null },
      {
        dailySheetId: { $exists: true, $ne: null },
        linkedToDailySheet: { $ne: true },
      },
    ],
  };

  const total = await Expense.countDocuments(query);
  console.log(`Expense records to scan: ${total}`);

  const dailySheetCache = new Map();
  const affectedDayKeys = new Set();

  let scanned = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  const cursor = Expense.find(query)
    .select('_id driverId date time createdAt dailySheetId linkedToDailySheet amount')
    .cursor();

  for (let expense = await cursor.next(); expense != null; expense = await cursor.next()) {
    scanned += 1;

    if (!needsExpenseFix(expense)) {
      unchanged += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const resolved = await resolveExpenseFields(expense, dailySheetCache);

    if (!resolved.driverId || !resolved.date || isNaN(resolved.date.getTime())) {
      skipped += 1;
      console.warn(
        `  skip expense ${expense._id}: could not resolve driverId/date (dailySheetId=${expense.dailySheetId || 'none'})`,
      );
      continue;
    }

    const willChange =
      !expense.driverId ||
      expense.driverId.toString() !== resolved.driverId.toString() ||
      !expense.date ||
      new Date(expense.date).getTime() !== resolved.date.getTime() ||
      expense.linkedToDailySheet !== resolved.linkedToDailySheet;

    if (!willChange) {
      unchanged += 1;
      const key = dayKey(resolved.driverId, resolved.date);
      if (key) affectedDayKeys.add(key);
      continue;
    }

    updated += 1;
    const key = dayKey(resolved.driverId, resolved.date);
    if (key) affectedDayKeys.add(key);

    if (dryRun) {
      console.log(
        `  would update expense ${expense._id}: driverId=${resolved.driverId}, date=${resolved.date.toISOString()}, linkedToDailySheet=${resolved.linkedToDailySheet}`,
      );
    } else {
      expense.driverId = resolved.driverId;
      expense.date = resolved.date;
      expense.linkedToDailySheet = resolved.linkedToDailySheet;
      // eslint-disable-next-line no-await-in-loop
      await expense.save();
    }

    if (scanned % 200 === 0) {
      console.log(`  processed ${scanned}/${total} | updated=${updated} | skipped=${skipped}`);
    }
  }

  console.log('Phase 1 complete');
  console.log(`  Scanned: ${scanned}`);
  console.log(`  Updated: ${updated}${dryRun ? ' (would update)' : ''}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`  Skipped (unresolvable): ${skipped}`);

  return affectedDayKeys;
}

async function collectAllExpenseDayKeys() {
  const keys = new Set();
  const cursor = Expense.find({
    driverId: { $exists: true, $ne: null },
    date: { $exists: true, $ne: null },
  })
    .select('driverId date')
    .cursor();

  for (let expense = await cursor.next(); expense != null; expense = await cursor.next()) {
    const key = dayKey(expense.driverId, expense.date);
    if (key) keys.add(key);
  }
  return keys;
}

async function backfillPayrollExpensesForDayKeys(dayKeys, { dryRun = false } = {}) {
  console.log(`Phase 2: recalculate payroll.totalExpenses${dryRun ? ' [DRY RUN]' : ''}...`);
  console.log(`  Unique driver/day pairs: ${dayKeys.size}`);

  let payrollUpdated = 0;
  let payrollUnchanged = 0;
  let payrollSkipped = 0;
  let processed = 0;

  for (const key of dayKeys) {
    processed += 1;
    const [userId, dateStr] = key.split('|');
    const [year, month, day] = dateStr.split('-').map(Number);
    const anchorDate = new Date(year, month - 1, day, 12, 0, 0, 0);
    const range = dayRangeFromDate(anchorDate);
    if (!range) {
      payrollSkipped += 1;
      continue;
    }

    const expenses = await Expense.find({
      driverId: userId,
      $or: [
        { date: { $gte: range.start, $lte: range.end } },
        { time: { $gte: range.start, $lte: range.end } },
      ],
    }).select('amount');

    const expectedTotal = round2(
      expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0),
    );

    const payrollRecords = await Payroll.find({
      userId,
      startTime: { $gte: range.start, $lte: range.end },
    }).select('_id totalExpenses');

    if (payrollRecords.length === 0) {
      payrollSkipped += 1;
      continue;
    }

    const needsUpdate = payrollRecords.some(
      (payroll) => round2(payroll.totalExpenses || 0) !== expectedTotal,
    );

    if (!needsUpdate) {
      payrollUnchanged += payrollRecords.length;
    } else if (dryRun) {
      for (const payroll of payrollRecords) {
        const current = round2(payroll.totalExpenses || 0);
        if (current !== expectedTotal) {
          payrollUpdated += 1;
          console.log(
            `  would update payroll ${payroll._id} (${dateStr}): totalExpenses ${current} -> ${expectedTotal}`,
          );
        } else {
          payrollUnchanged += 1;
        }
      }
    } else {
      // eslint-disable-next-line no-await-in-loop
      await recalculatePayrollExpenses(anchorDate, userId);
      payrollUpdated += payrollRecords.length;
    }

    if (processed % 100 === 0) {
      console.log(`  processed ${processed}/${dayKeys.size} day keys`);
    }
  }

  console.log('Phase 2 complete');
  console.log(`  Payroll rows updated: ${payrollUpdated}${dryRun ? ' (would update)' : ''}`);
  console.log(`  Payroll rows already correct: ${payrollUnchanged}`);
  console.log(`  Day keys with no payroll: ${payrollSkipped}`);
}

async function backfillExpenses(options = {}) {
  const { dryRun = false, expensesOnly = false, payrollOnly = false } = options;

  if (!payrollOnly) {
    await backfillExpenseDocuments({ dryRun });
  }

  if (!expensesOnly) {
    const dayKeys = await collectAllExpenseDayKeys();
    await backfillPayrollExpensesForDayKeys(dayKeys, { dryRun });
  }
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const expensesOnly = process.argv.includes('--expenses-only');
  const payrollOnly = process.argv.includes('--payroll-only');

  if (expensesOnly && payrollOnly) {
    console.error('Use only one of --expenses-only or --payroll-only');
    process.exit(1);
  }

  try {
    await connectToDatabase();
    console.log('MongoDB connected');
    await backfillExpenses({ dryRun, expensesOnly, payrollOnly });
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Expense backfill failed:', error);
    try {
      await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
  }
}

if (require.main === module) run();

module.exports = { backfillExpenses, backfillExpenseDocuments, backfillPayrollExpensesForDayKeys };
