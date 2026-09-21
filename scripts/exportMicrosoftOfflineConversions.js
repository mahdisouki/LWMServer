/**
 * Export Microsoft Ads offline conversions (quote-to-purchase) as CSV for manual upload.
 *
 * Finds Paid tasks linked to a quotation that have an msclkid (on the task or the quote).
 *
 * Usage:
 *   node scripts/exportMicrosoftOfflineConversions.js
 *   node scripts/exportMicrosoftOfflineConversions.js --dry-run
 *   node scripts/exportMicrosoftOfflineConversions.js --include-exported
 *   node scripts/exportMicrosoftOfflineConversions.js --mark-exported
 *   node scripts/exportMicrosoftOfflineConversions.js --out ./exports/ms-offline.csv
 *   node scripts/exportMicrosoftOfflineConversions.js --timezone +0000
 *
 * Env (optional):
 *   MICROSOFT_ADS_OFFLINE_CONVERSION_NAME=quote-to-purchase
 *   MICROSOFT_ADS_CSV_TIMEZONE=+0000
 *
 * Upload the CSV in Microsoft Advertising → Conversions → Upload conversions.
 *
 * Note: This CSV format is for the Microsoft Ads UI only. The automatic API upload
 * (microsoftAdsConversionService) uses ApplyOfflineConversions with ISO UTC times
 * and is unaffected by this script.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Task = require('../models/Task');
const QuotationRequest = require('../models/QuotationRequest');
const PaymentHistory = require('../models/PaymentHistory');

const CONVERSION_NAME =
  process.env.MICROSOFT_ADS_OFFLINE_CONVERSION_NAME || 'quote-to-purchase';
const CURRENCY = 'GBP';
const PAID_STATUSES = ['Paid'];
const DEFAULT_TIMEZONE =
  process.env.MICROSOFT_ADS_CSV_TIMEZONE || '+0000';

async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGO_URI or MONGODB_URI missing in .env');
  }
  await mongoose.connect(uri);
}

function parseArgs(argv) {
  const args = {
    dryRun: argv.includes('--dry-run'),
    includeExported: argv.includes('--include-exported'),
    markExported: argv.includes('--mark-exported'),
    out: null,
    timezone: DEFAULT_TIMEZONE,
  };

  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--out' && argv[i + 1]) {
      args.out = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--timezone' && argv[i + 1]) {
      args.timezone = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

function csvEscape(value) {
  const str = value == null ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Microsoft Ads UI CSV expects MM/DD/YYYY HH:MM:SS (not ISO-8601).
 * Times are written in UTC; pair with TimeZone=+0000 in the parameters row.
 */
function formatConversionTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}`;
}

async function resolveConversionTime(task) {
  const payment = await PaymentHistory.findOne({
    taskId: task._id,
    status: 'success',
  })
    .sort({ paymentDate: -1 })
    .select('paymentDate')
    .lean();

  if (payment?.paymentDate) return payment.paymentDate;
  if (task.updatedAt) return task.updatedAt;
  return task.createdAt || new Date();
}

async function resolveMsclkid(task) {
  if (task.msclkid && String(task.msclkid).trim()) {
    return String(task.msclkid).trim();
  }
  if (!task.quotationId) return null;

  const quote = await QuotationRequest.findById(task.quotationId)
    .select('msclkid')
    .lean();
  const fromQuote = quote?.msclkid && String(quote.msclkid).trim();
  return fromQuote || null;
}

function resolveValue(task) {
  if (task.totalPrice != null && !Number.isNaN(Number(task.totalPrice))) {
    return Number(task.totalPrice);
  }
  if (task.paidAmount?.amount != null && !Number.isNaN(Number(task.paidAmount.amount))) {
    return Number(task.paidAmount.amount);
  }
  return 1;
}

async function main() {
  const args = parseArgs(process.argv);
  await connectDB();

  const query = {
    quotationId: { $ne: null },
    paymentStatus: { $in: PAID_STATUSES },
  };
  if (!args.includeExported) {
    query.microsoftAdsOfflineConversionExportedAt = null;
  }

  const tasks = await Task.find(query)
    .select(
      'orderNumber quotationId paymentStatus totalPrice paidAmount msclkid updatedAt createdAt microsoftAdsOfflineConversionExportedAt',
    )
    .sort({ updatedAt: -1 });

  console.log(`Conversion name: ${CONVERSION_NAME}`);
  console.log(`CSV TimeZone: ${args.timezone} (times are UTC wall-clock)`);
  console.log(`Paid quote-linked tasks scanned: ${tasks.length}`);
  console.log(`Mode: ${args.dryRun ? 'DRY RUN' : 'WRITE CSV'}${args.markExported ? ' + mark exported' : ''}\n`);

  const rows = [];
  const summary = {
    scanned: tasks.length,
    exported: 0,
    skippedNoMsclkid: 0,
    skippedBadTime: 0,
    marked: 0,
    errors: 0,
  };

  for (const task of tasks) {
    try {
      const msclkid = await resolveMsclkid(task);
      if (!msclkid) {
        summary.skippedNoMsclkid += 1;
        continue;
      }

      const conversionTimeRaw = await resolveConversionTime(task);
      const conversionTime = formatConversionTime(conversionTimeRaw);
      if (!conversionTime) {
        summary.skippedBadTime += 1;
        continue;
      }

      rows.push({
        taskId: task._id,
        orderNumber: task.orderNumber || String(task._id),
        microsoftClickId: msclkid,
        conversionName: CONVERSION_NAME,
        conversionTime,
        conversionValue: resolveValue(task),
        conversionCurrency: CURRENCY,
      });
      summary.exported += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(`[error] ${task.orderNumber || task._id}:`, error.message);
    }
  }

  // Microsoft Ads UI template: parameters row + exact columns (no extras).
  const header = [
    'Microsoft Click Id',
    'Conversion Name',
    'Conversion Time',
    'Conversion Value',
    'Conversion Currency',
  ];

  const csvLines = [
    '### PARAMETERS ###',
    `TimeZone,${args.timezone}`,
    '### DATA ###',
    header.join(','),
    ...rows.map((row) => [
      csvEscape(row.microsoftClickId),
      csvEscape(row.conversionName),
      csvEscape(row.conversionTime),
      csvEscape(row.conversionValue),
      csvEscape(row.conversionCurrency),
    ].join(',')),
  ];

  const csv = `${csvLines.join('\n')}\n`;

  if (rows.length > 0) {
    console.log('Orders in CSV (not a Microsoft column):');
    rows.forEach((row) => {
      console.log(`  ${row.orderNumber} @ ${row.conversionTime}`);
    });
    console.log('');
  }

  if (!args.dryRun) {
    const outPath = path.resolve(
      args.out
        || path.join(
          __dirname,
          '..',
          'exports',
          `microsoft-offline-conversions-${new Date().toISOString().slice(0, 10)}.csv`,
        ),
    );
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, csv, 'utf8');
    console.log(`Wrote ${rows.length} row(s) → ${outPath}`);
  } else {
    console.log('--- DRY RUN preview ---');
    console.log(csvLines.slice(0, Math.min(csvLines.length, 8)).join('\n'));
  }

  if (args.markExported && !args.dryRun && rows.length > 0) {
    const ids = rows.map((r) => r.taskId);
    const result = await Task.updateMany(
      { _id: { $in: ids } },
      { $set: { microsoftAdsOfflineConversionExportedAt: new Date() } },
    );
    summary.marked = result.modifiedCount || 0;
    console.log(`Marked exported: ${summary.marked}`);
  }

  console.log('\n--- Summary ---');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nUpload in Microsoft Ads → Conversions → Upload conversions (goal: ${CONVERSION_NAME})`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
