require('dotenv').config();
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');

const connectToDatabase = require('../config/db');
const Payroll = require('../models/Payroll');
const { User } = require('../models/User');
const Truck = require('../models/Truck');
const Van = require('../models/Van');

// Parse "DD/MM/YYYY" + "HH:mm:ss" into a JS Date
function parseUkDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const [day, month, year] = String(dateStr).split('/').map(Number);
  const [hh, mm, ss] = String(timeStr).split(':').map(Number);
  const date = new Date(year, month - 1, day, hh, mm, ss || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

// "£100.00" -> 100
function parseMoney(value) {
  if (!value) return 0;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  const num = parseFloat(cleaned);
  return Number.isNaN(num) ? 0 : num;
}

// Difference in hours between two Date objects, rounded to 2 decimals
function hoursDiff(start, end) {
  if (!start || !end) return 0;
  const ms = end - start;
  return Math.round((ms / (1000 * 60 * 60)) * 100) / 100;
}

// Optionally resolve Truck from "Van used" (matricule). vanReg is set directly from CSV string.
async function resolveTruckIdFromVanUsed(vanUsed) {
  if (!vanUsed) return null;
  const van = await Van.findOne({ matricule: String(vanUsed).trim() });
  if (!van) return null;
  const truck = await Truck.findOne({ vanId: van._id });
  return truck ? truck._id : null;
}

async function processRow(row, username) {
  // 1) Find user by username from filename, case-insensitive (e.g. "Eduart" matches "eduart")
  const user = await User.findOne({
    username: { $regex: new RegExp(`^${String(username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
  });
  if (!user) {
    console.warn(`⚠️ User not found for username "${username}", skipping row`);
    return;
  }

  // 2) Use only startTime/endTime from CSV (ignore TOTAL column)
  const startTime = parseUkDateTime(row.Date, row.Start);
  const endTime = parseUkDateTime(row.Date, row.End);
  const totalHoursWorked = hoursDiff(startTime, endTime);

  // 3) regularHours, extraHours, totalSalary from user attributes (hourPrice, extraHourPrice, regularHours)
  const limit = user.regularHours ?? 12;
  let regularHours = totalHoursWorked;
  let extraHours = 0;
  let totalSalary = 0;
  if (totalHoursWorked <= limit) {
    regularHours = totalHoursWorked;
    extraHours = 0;
    totalSalary = user.hourPrice ?? 0;
  } else {
    regularHours = limit;
    extraHours = Math.round((totalHoursWorked - limit) * 100) / 100;
    totalSalary = (user.hourPrice ?? 0) + extraHours * (user.extraHourPrice ?? 0);
  }

  // 4) Van registration as string from CSV; optionally resolve truckId from matricule
  const vanReg = (row['Van used'] || '').trim() || undefined;
  const truckId = await resolveTruckIdFromVanUsed(row['Van used']);

  // 5) Deduce payroll status from "PAID?" column
  const paidRaw = (row['PAID?'] || '').toString().trim().toUpperCase();
  const status =
    paidRaw === 'YES' || paidRaw === 'PAID' || paidRaw === 'TRUE'
      ? 'Paid'
      : 'Pending';

  // 6) Working with (from CSV "Working with" column)
  const workingWith = (row['Working with'] || '').trim() || undefined;

  // 7) Build notes (OT from CSV for reference only, not used for salary)
  const otAmount = parseMoney(row.OT);
  const extraNotesParts = [];
  if (row.Notes) extraNotesParts.push(`Notes: ${row.Notes}`);
  if (row['LATE?']) extraNotesParts.push(`Late: ${row['LATE?']}`);
  if (otAmount > 0) extraNotesParts.push(`OT amount: £${otAmount.toFixed(2)}`);
  const combinedNotes = extraNotesParts.length > 0 ? extraNotesParts.join(' | ') : null;

  // 8) Create Payroll document.
  const payroll = new Payroll({
    userId: user._id,
    startTime,
    endTime,
    notes: combinedNotes,
    workingWith,
    vanReg,
    truckId,
    totalHoursWorked,
    regularHours,
    extraHours,
    totalSalary,
    totalExpenses: 0,
    totalPcnDamages: 0,
    totalCash: 0,
    status,
  });

  await payroll.save();
  console.log(
    `✅ Payroll created for ${username} on ${row.Date} (hours=${totalHoursWorked}, total=£${totalSalary.toFixed(
      2
    )})`,
  );
}

async function importCsv(filePath) {
  await connectToDatabase();
  console.log('✅ MongoDB connected');

  const base = path.basename(filePath);
  const username = base.replace(path.extname(base), '');

  return new Promise((resolve, reject) => {
    const rows = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', async () => {
        console.log(`📄 Read ${rows.length} rows from CSV for user "${username}"`);
        try {
          for (const row of rows) {
            if (!row.Date || !row.Start || !row.End) continue;
            // eslint-disable-next-line no-await-in-loop
            await processRow(row, username);
          }
          console.log('🎉 Import finished');
          resolve();
        } catch (err) {
          console.error('Error during import:', err);
          reject(err);
        } finally {
          await require('mongoose').disconnect();
        }
      })
      .on('error', async (err) => {
        console.error('CSV read error:', err);
        try {
          await require('mongoose').disconnect();
        } catch (e) {
          // ignore
        }
        reject(err);
      });
  });
}

// CLI usage:
//   node scripts/importStaffHoursPayroll.js PayrollSheets/Eduart.csv
//   node scripts/importStaffHoursPayroll.js PayrollSheets/Marius.csv
if (require.main === module) {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node scripts/importStaffHoursPayroll.js <path/to/staff-hours.csv>');
    process.exit(1);
  }

  const absPath = path.resolve(csvPath);
  importCsv(absPath).catch((err) => {
    console.error('Import error:', err);
    process.exit(1);
  });
}

module.exports = { importCsv };

