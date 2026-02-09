require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');
const StandardItem = require('../models/StandardItem');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI or MONGODB_URI missing in .env');
  process.exit(1);
}

const EXCEL_PATH = path.join(__dirname, '..', 'mahdi.standarditems.xlsx');

function normalizeHeader(str) {
  if (str == null) return '';
  return String(str).trim().toLowerCase().replace(/\s+/g, '');
}

const FIELD_MAP = {
  spaceofvan: 'spaceOfVan',
  timespentoutside: 'timespentOutside',
  timespentinside: 'timespentInside',
  timespentinsdiewithdis: 'timespentInsdiewithDis',
  itemname: 'itemName',
  name: 'itemName',
  item: 'itemName',
};

function parseNum(val) {
  if (val === null || val === undefined || val === '') return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  let workbook;
  try {
    workbook = XLSX.readFile(EXCEL_PATH);
  } catch (e) {
    console.error('❌ Could not read Excel file:', EXCEL_PATH, e.message);
    process.exit(1);
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

  if (!rows.length) {
    console.log('No data rows in sheet:', sheetName);
    await mongoose.disconnect();
    return;
  }

  const firstRow = rows[0];
  const headers = Object.keys(firstRow).map((raw) => ({
    raw,
    key: normalizeHeader(raw),
  }));

  let itemNameKey = null;
  for (const { raw, key } of headers) {
    if (FIELD_MAP[key] === 'itemName') {
      itemNameKey = raw;
      break;
    }
  }
  if (!itemNameKey) {
    itemNameKey = headers[0]?.raw ?? Object.keys(firstRow)[0];
    console.log('Using first column as item name:', itemNameKey);
  }

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const row of rows) {
    const name = (row[itemNameKey] ?? row.itemName ?? row.ItemName ?? '').toString().trim();
    if (!name) {
      skipped++;
      continue;
    }

    const item = await StandardItem.findOne({ itemName: name });
    if (!item) {
      console.log('⚠️ StandardItem not found for name:', name);
      notFound++;
      continue;
    }

    const update = {};
    for (const { raw, key } of headers) {
      const field = FIELD_MAP[key];
      if (!field || field === 'itemName') continue;
      const val = row[raw];
      const num = parseNum(val);
      if (num !== undefined) update[field] = num;
    }

    if (Object.keys(update).length === 0) continue;

    await StandardItem.findByIdAndUpdate(item._id, { $set: update });
    updated++;
    console.log('Updated:', name, update);
  }

  console.log('\nDone. Updated:', updated, 'Skipped (no name):', skipped, 'Not found:', notFound);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
