/**
 * Migration: PcnDamage independent of DailySheet
 *
 * Ensure DailySheet.pcnDamages includes all PCNs that reference it via dailySheetId.
 * (PcnDamage uses `time` for date - no backfill needed)
 *
 * Run: node scripts/migratePcnDamageToIndependent.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const PcnDamage = require('../models/PcnDamage');
const DailySheet = require('../models/DailySheet');

const connectDB = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ MongoDB Connected');
};

const migrate = async () => {
  console.log('🚀 Starting PcnDamage migration (independent of DailySheet)...\n');

  // 2. Ensure DailySheet.pcnDamages includes PCNs that reference it (legacy dailySheetId)
  const pcnsWithDailySheet = await PcnDamage.find({
    dailySheetId: { $exists: true, $ne: null }
  });

  let sheetsUpdated = 0;
  for (const pcn of pcnsWithDailySheet) {
    const sheet = await DailySheet.findById(pcn.dailySheetId);
    if (!sheet) continue;

    sheet.pcnDamages = sheet.pcnDamages || [];
    const hasPcn = sheet.pcnDamages.some(id => id.toString() === pcn._id.toString());
    if (!hasPcn) {
      sheet.pcnDamages.push(pcn._id);
      await sheet.save();
      sheetsUpdated++;
    }
  }

  console.log(`\n📊 Ensured DailySheet.pcnDamages: ${sheetsUpdated} sheets updated`);
  console.log('\n✅ Migration completed');
};

const run = async () => {
  try {
    await connectDB();
    await migrate();
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

if (require.main === module) run();
