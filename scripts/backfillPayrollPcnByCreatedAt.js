require('dotenv').config();
const mongoose = require('mongoose');
const connectToDatabase = require('../config/db');
const Payroll = require('../models/Payroll');
const PcnDamage = require('../models/PcnDamage');

function getDayRange(date) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { start, end };
}

async function recalcPayrollPcnByCreatedAt({ dryRun = false } = {}) {
  console.log(`Starting payroll PCN backfill (createdAt based)${dryRun ? ' [DRY RUN]' : ''}...`);

  const query = { startTime: { $exists: true, $ne: null } };
  const totalPayrolls = await Payroll.countDocuments(query);
  console.log(`Payroll records to scan: ${totalPayrolls}`);

  let scanned = 0;
  let updated = 0;
  let unchanged = 0;

  const cursor = Payroll.find(query).select('_id userId startTime totalPcnDamages').cursor();

  for (let payroll = await cursor.next(); payroll != null; payroll = await cursor.next()) {
    scanned += 1;
    const { start, end } = getDayRange(payroll.startTime);

    // eslint-disable-next-line no-await-in-loop
    const pcnDamages = await PcnDamage.find({
      deductedFromUserId: payroll.userId,
      createdAt: { $gte: start, $lte: end },
    }).select('amount');

    const recalculatedTotal = pcnDamages.reduce((sum, pcn) => sum + (pcn.amount || 0), 0);
    const currentTotal = payroll.totalPcnDamages || 0;

    if (currentTotal !== recalculatedTotal) {
      updated += 1;
      if (!dryRun) {
        payroll.totalPcnDamages = recalculatedTotal;
        // eslint-disable-next-line no-await-in-loop
        await payroll.save();
      }
    } else {
      unchanged += 1;
    }

    if (scanned % 200 === 0) {
      console.log(`processed ${scanned}/${totalPayrolls} | updated=${updated} | unchanged=${unchanged}`);
    }
  }

  console.log('Backfill completed');
  console.log(`Scanned: ${scanned}`);
  console.log(`Updated: ${updated}${dryRun ? ' (would update)' : ''}`);
  console.log(`Unchanged: ${unchanged}`);
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');

  try {
    await connectToDatabase();
    console.log('MongoDB connected');
    await recalcPayrollPcnByCreatedAt({ dryRun });
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

module.exports = { recalcPayrollPcnByCreatedAt };
