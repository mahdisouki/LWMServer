/**
 * Match a Google Ads Call details CSV to orders and set trafficSource to Google Ads.
 *
 * Download the report (Duration > 20) as CSV, then:
 *   node scripts/syncGoogleAdsCallTrafficSources.js --file=calls.csv --dry-run
 *   node scripts/syncGoogleAdsCallTrafficSources.js --file=calls.csv
 *   node scripts/syncGoogleAdsCallTrafficSources.js --file=calls.csv --window=7 --min-duration=20
 *
 * Phone prefixes that match the same number:
 *   +44 7864 396584, +447864396584, 447864396584, 00447864396584,
 *   07864396584, 7864396584, +44 (0) 7864 396584
 *
 * The earliest order after the call (within the window) is the one stamped.
 * Organic, Direct, and empty sources only. An already attributed earliest order is skipped.
 * A matched call sets subsource to phone when it is still empty. Quotation, Tawk,
 * email, and website stay as they are.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const Task = require('../models/Task');
const { excludeMigratedOrdersFilter } = require('../services/analytics/taskFilters');
const { ANALYTICS_TIMEZONE } = require('../utils/analyticsDateRange');

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_MIN_DURATION_SECONDS = 20;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function phoneMatchKey(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('44')) {
    digits = digits.slice(2);
    if (digits.startsWith('0')) digits = digits.slice(1);
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits.length >= 10 ? digits : '';
}

function phoneMatchKeys(phone) {
  const parts = String(phone || '').split(/\s*(?:\/|;|\bor\b)\s*/i);
  const keys = [];
  const seen = new Set();
  for (const part of parts) {
    const key = phoneMatchKey(part);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function canStampGoogleAds(currentTrafficSource) {
  return (
    !currentTrafficSource
    || currentTrafficSource === 'Organic'
    || currentTrafficSource === 'Direct'
  );
}

function headerKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function pickColumn(row, aliases) {
  const wanted = new Set(aliases.map(headerKey));
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(headerKey(key))) return value;
  }
  return '';
}

function zonedWallTimeToUtc(dayKey, hours, minutes, seconds) {
  const [year, month, day] = dayKey.split('-').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  const offset = (instant) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: ANALYTICS_TIMEZONE,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant);
    const map = {};
    for (const part of parts) {
      if (part.type !== 'literal') map[part.type] = part.value;
    }
    const asUtc = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour) % 24,
      Number(map.minute),
      Number(map.second),
    );
    return asUtc - instant.getTime();
  };
  let instant = new Date(utcGuess - offset(new Date(utcGuess)));
  instant = new Date(utcGuess - offset(instant));
  return instant;
}

function parseCallStartTime(value) {
  const raw = String(value || '').trim().replace(/^"+|"+$/g, '');
  if (!raw) return null;

  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return zonedWallTimeToUtc(
      `${match[1]}-${match[2]}-${match[3]}`,
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0),
    );
  }

  match = raw.match(
    /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i,
  );
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    if (!month) return null;
    let hour = Number(match[4]);
    const ampm = String(match[7] || '').toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    const dayKey = `${match[3]}-${String(month).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`;
    return zonedWallTimeToUtc(dayKey, hour, Number(match[5]), Number(match[6] || 0));
  }

  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const dayKey = `${match[3]}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
    return zonedWallTimeToUtc(dayKey, Number(match[4]), Number(match[5]), Number(match[6] || 0));
  }

  return null;
}

function parseDurationSeconds(value) {
  const match = String(value || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const seconds = Number(match[0]);
  return Number.isFinite(seconds) ? seconds : null;
}

function callerPhone(row) {
  const phone = String(pickColumn(row, [
    'caller phone number',
    'phone number',
    'caller number',
  ]) || '').trim();
  const country = String(pickColumn(row, ['caller country code', 'country code']) || '').replace(/\D/g, '');
  if (phoneMatchKey(phone)) return phone;
  if (country && phoneMatchKey(`${country}${phone}`)) return `${country}${phone}`;
  return phone;
}

async function findHeaderSkipLines(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let index = 0;
  try {
    for await (const line of lines) {
      const key = headerKey(line);
      if (key.includes('caller phone number') || key.includes('phone number')) return index;
      index += 1;
      if (index > 30) break;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return 0;
}

async function readCalls(filePath, minDurationSeconds) {
  const skipLines = await findHeaderSkipLines(filePath);
  const calls = [];
  let skippedShort = 0;
  let skippedBadRow = 0;
  let rows = 0;

  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv({ skipLines }))
      .on('data', (row) => {
        rows += 1;
        const startedAt = parseCallStartTime(pickColumn(row, ['start time', 'call start time']));
        const durationSeconds = parseDurationSeconds(
          pickColumn(row, ['duration (seconds)', 'duration', 'call duration (seconds)']),
        );
        const phone = callerPhone(row);
        const phoneKey = phoneMatchKey(phone);
        if (!startedAt || !phoneKey) {
          skippedBadRow += 1;
          return;
        }
        if (durationSeconds == null || durationSeconds <= minDurationSeconds) {
          skippedShort += 1;
          return;
        }
        calls.push({
          rowNumber: skipLines + rows + 1,
          startedAt,
          durationSeconds,
          phone,
          phoneKey,
        });
      })
      .on('error', reject)
      .on('end', resolve);
  });

  calls.sort((a, b) => a.startedAt - b.startedAt);
  return { calls, rows, skippedShort, skippedBadRow };
}

function orderInWindow(callStartedAt, orderCreatedAt, windowDays) {
  const orderMs = new Date(orderCreatedAt).getTime();
  const callMs = callStartedAt.getTime();
  if (orderMs < callMs) return false;
  return orderMs - callMs <= windowDays * MS_PER_DAY;
}

async function syncFromCsv({ filePath, windowDays, minDurationSeconds, dryRun }) {
  const { calls, rows, skippedShort, skippedBadRow } = await readCalls(filePath, minDurationSeconds);
  const summary = {
    dryRun,
    filePath,
    windowDays,
    minDurationSeconds,
    rows,
    calls: calls.length,
    skippedShort,
    skippedBadRow,
    candidates: 0,
    matched: 0,
    updated: 0,
    noMatch: 0,
    notApplicable: 0,
    alreadyClaimed: 0,
    errors: 0,
    samples: [],
  };
  if (!calls.length) return summary;

  const earliestCallAt = calls[0].startedAt;
  const latestOrderAt = new Date(calls[calls.length - 1].startedAt.getTime() + windowDays * MS_PER_DAY);
  const orders = await Task.find({
    createdAt: { $gte: earliestCallAt, $lte: latestOrderAt },
    paymentStatus: { $ne: 'Failed' },
    createdByType: { $in: ['public', 'Admin'] },
    ...excludeMigratedOrdersFilter,
  })
    .select('_id orderNumber phoneNumber phoneNumber2 trafficSource subsource createdAt')
    .lean();

  summary.candidates = orders.length;
  const byPhone = new Map();
  for (const order of orders) {
    for (const raw of [order.phoneNumber, order.phoneNumber2]) {
      for (const key of phoneMatchKeys(raw)) {
        if (!byPhone.has(key)) byPhone.set(key, []);
        byPhone.get(key).push(order);
      }
    }
  }

  const claimed = new Set();
  for (const call of calls) {
    const seen = new Set();
    const hits = (byPhone.get(call.phoneKey) || [])
      .filter((order) => {
        const id = String(order._id);
        if (seen.has(id)) return false;
        seen.add(id);
        return orderInWindow(call.startedAt, order.createdAt, windowDays);
      })
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a._id).localeCompare(String(b._id)));

    if (!hits.length) {
      summary.noMatch += 1;
      continue;
    }

    const order = hits[0];
    if (!canStampGoogleAds(order.trafficSource)) {
      summary.notApplicable += 1;
      continue;
    }

    const orderId = String(order._id);
    if (claimed.has(orderId)) {
      summary.alreadyClaimed += 1;
      continue;
    }
    claimed.add(orderId);
    summary.matched += 1;

    const subsourceToSet = order.subsource ? null : 'phone';
    if (summary.samples.length < 20) {
      summary.samples.push({
        row: call.rowNumber,
        phone: call.phone,
        orderNumber: order.orderNumber,
        from: order.trafficSource || null,
        to: 'Google Ads',
        subsourceFrom: order.subsource || null,
        subsourceTo: order.subsource || 'phone',
        callStartedAt: call.startedAt.toISOString(),
      });
    }

    if (dryRun) {
      summary.updated += 1;
      continue;
    }

    try {
      const $set = { trafficSource: 'Google Ads' };
      if (subsourceToSet) $set.subsource = subsourceToSet;
      const result = await Task.updateOne(
        {
          _id: order._id,
          createdByType: { $in: ['public', 'Admin'] },
          $or: [
            { trafficSource: 'Organic' },
            { trafficSource: 'Direct' },
            { trafficSource: { $exists: false } },
            { trafficSource: null },
          ],
        },
        { $set },
      );
      if (result.modifiedCount > 0) summary.updated += 1;
      else summary.notApplicable += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(`[Google Ads calls] Failed ${order.orderNumber}:`, error.message);
    }
  }

  return summary;
}

function parseArgs(argv) {
  let dryRun = false;
  let filePath = '';
  let windowDays = DEFAULT_WINDOW_DAYS;
  let minDurationSeconds = DEFAULT_MIN_DURATION_SECONDS;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    const fileMatch = arg.match(/^--file=(.+)$/);
    if (fileMatch) {
      filePath = path.resolve(fileMatch[1]);
      continue;
    }
    const windowMatch = arg.match(/^--window=(\d+)$/);
    if (windowMatch) {
      windowDays = Math.min(Math.max(parseInt(windowMatch[1], 10), 1), 30);
      continue;
    }
    const durationMatch = arg.match(/^--min-duration=(\d+)$/);
    if (durationMatch) minDurationSeconds = Math.max(parseInt(durationMatch[1], 10), 0);
  }

  return { dryRun, filePath, windowDays, minDurationSeconds };
}

async function main() {
  const { dryRun, filePath, windowDays, minDurationSeconds } = parseArgs(process.argv.slice(2));
  if (!filePath) throw new Error('Pass the Call details CSV with --file=path/to/calls.csv');
  if (!fs.existsSync(filePath)) throw new Error(`CSV not found: ${filePath}`);

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI or MONGODB_URI missing in .env');
  await mongoose.connect(uri);

  console.log(
    `Mode: ${dryRun ? 'DRY RUN' : 'APPLY'} | windowDays=${windowDays} | minDuration>${minDurationSeconds}s\n` +
      `File: ${filePath}\n`,
  );
  const summary = await syncFromCsv({ filePath, windowDays, minDurationSeconds, dryRun });
  console.log('\n--- Summary ---');
  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
