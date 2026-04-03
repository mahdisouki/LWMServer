/**
 * Migration: DailySheet.fuelLogs from embedded subdocuments to Fuel document refs.
 *
 * For each daily sheet whose fuelLogs array still contains objects with `amount`,
 * creates Fuel documents and replaces those entries with ObjectIds.
 * Entries that are already ObjectIds are left unchanged.
 *
 * Run: node scripts/migrateDailySheetFuelLogsToFuel.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const DailySheet = require('../models/DailySheet');
const Fuel = require('../models/Fuel');

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected');
};

function isEmbeddedFuelEntry(entry) {
  if (entry == null || typeof entry !== 'object') return false;
  if (entry instanceof mongoose.Types.ObjectId) return false;
  if (entry._bsontype === 'ObjectId') return false;
  return Object.prototype.hasOwnProperty.call(entry, 'amount');
}

const migrate = async () => {
  const col = mongoose.connection.db.collection(DailySheet.collection.name);
  const cursor = col.find({
    fuelLogs: { $exists: true, $type: 'array', $ne: [] },
  });

  let sheetsUpdated = 0;
  let fuelsCreated = 0;

  for await (const doc of cursor) {
    const logs = doc.fuelLogs;
    if (!Array.isArray(logs) || logs.length === 0) continue;

    const hasEmbedded = logs.some(isEmbeddedFuelEntry);
    if (!hasEmbedded) continue;

    const newIds = [];
    for (const entry of logs) {
      if (isEmbeddedFuelEntry(entry)) {
        const amount = Number(entry.amount);
        if (Number.isNaN(amount)) {
          throw new Error(
            `Invalid amount on sheet ${doc._id} fuel entry: ${JSON.stringify(entry)}`,
          );
        }
        const fuelDoc = await Fuel.create({
          driverId: doc.driverId,
          dailySheetId: doc._id,
          amount,
          litres: entry.litres != null ? Number(entry.litres) : undefined,
          time: entry.time ? new Date(entry.time) : doc.date,
          station: entry.station,
          addedBy: entry.addedBy,
          date: entry.time ? new Date(entry.time) : doc.date,
          linkedToDailySheet: true,
        });
        newIds.push(fuelDoc._id);
        fuelsCreated += 1;
      } else {
        newIds.push(new mongoose.Types.ObjectId(entry));
      }
    }

    await col.updateOne({ _id: doc._id }, { $set: { fuelLogs: newIds } });
    sheetsUpdated += 1;
  }

  console.log(`Sheets updated: ${sheetsUpdated}`);
  console.log(`Fuel documents created: ${fuelsCreated}`);
};

const run = async () => {
  try {
    await connectDB();
    await migrate();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
};

if (require.main === module) run();
