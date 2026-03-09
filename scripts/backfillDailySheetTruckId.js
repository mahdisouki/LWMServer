/**
 * Backfill truckId on DailySheet documents using scripts/dailyDriverTruckAssignments.tsv.
 * Matches by driverId and date (day), then sets truckId from the TSV.
 *
 * Run: node scripts/backfillDailySheetTruckId.js
 * Requires: .env with MONGODB_URI or MONGO_URI
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const DailySheet = require('../models/DailySheet');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI or MONGODB_URI not set in .env');
  process.exit(1);
}

const TSV_PATH = path.join(__dirname, 'dailyDriverTruckAssignments.tsv');

function parseTsv(content) {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split('\t');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const row = {};
    header.forEach((h, j) => { row[h] = values[j] != null ? values[j].trim() : ''; });
    if (row.date && row.driverId && row.truckId) rows.push(row);
  }
  return rows;
}

function dayBounds(dateStr) {
  // dateStr is YYYY-MM-DD; treat as UTC day
  const start = new Date(dateStr + 'T00:00:00.000Z');
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const tsvContent = fs.readFileSync(TSV_PATH, 'utf8');
  const rows = parseTsv(tsvContent);
  console.log(`📄 Loaded ${rows.length} rows from ${path.basename(TSV_PATH)}`);

  let updated = 0;
  let notFound = 0;

  for (const row of rows) {
    const { start, end } = dayBounds(row.date);
    const driverId = new mongoose.Types.ObjectId(row.driverId);
    const truckId = new mongoose.Types.ObjectId(row.truckId);

    const result = await DailySheet.updateMany(
      {
        driverId,
        date: { $gte: start, $lt: end },
      },
      { $set: { truckId } }
    );

    if (result.matchedCount > 0) {
      updated += result.modifiedCount;
      if (result.modifiedCount > 0) {
        console.log(`  ${row.date} driverId=${row.driverId.slice(-6)} → truckId=${row.truckId.slice(-6)} (${result.modifiedCount} updated)`);
      }
    } else {
      notFound++;
    }
  }

  console.log('\n✅ Done.');
  console.log(`   Total rows in TSV: ${rows.length}`);
  console.log(`   DailySheets updated: ${updated}`);
  if (notFound > 0) console.log(`   Rows with no matching DailySheet: ${notFound}`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
