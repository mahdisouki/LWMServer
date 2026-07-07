const ClaritySnapshot = require('../../models/ClaritySnapshot');
const QuotationRequest = require('../../models/QuotationRequest');
const Task = require('../../models/Task');
const { resolvePeriod } = require('./dashboardService');
const { findMetric, parseIntSafe } = require('../../utils/clarityMetricsParser');

const DEVICE_BUCKETS = [
  { id: 'mobile', label: 'Mobile', clarityValues: ['Mobile'], color: 'blue' },
  { id: 'desktop', label: 'Desktop', clarityValues: ['PC'], color: 'green' },
  { id: 'tablet', label: 'Tablet', clarityValues: ['Tablet'], color: 'orange' },
];

function startOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function toDateString(date) {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function normalizeDeviceBucket(deviceValue) {
  const value = String(deviceValue || '').trim();
  const match = DEVICE_BUCKETS.find((bucket) => bucket.clarityValues.includes(value));
  return match?.id || 'other';
}

function extractDeviceSessions(devicesData) {
  const traffic = findMetric(devicesData, 'Traffic');
  const totals = {
    mobile: 0,
    desktop: 0,
    tablet: 0,
    other: 0,
  };

  for (const row of traffic?.information || []) {
    const bucket = normalizeDeviceBucket(row.Device);
    totals[bucket] += parseIntSafe(row.totalSessionCount);
  }

  return totals;
}

function buildDeviceBreakdown(sessionTotals) {
  const knownTotal = DEVICE_BUCKETS.reduce(
    (sum, bucket) => sum + (sessionTotals[bucket.id] || 0),
    0,
  );

  return DEVICE_BUCKETS.map((bucket) => {
    const sessions = sessionTotals[bucket.id] || 0;
    return {
      id: bucket.id,
      label: bucket.label,
      color: bucket.color,
      sessions,
      sharePercent: knownTotal > 0 ? roundPercent((sessions / knownTotal) * 100) : 0,
      conversionRate: null,
      conversionApplicable: false,
    };
  });
}

async function getDevices({ preset, startDate, endDate } = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });

  const [deviceSnapshots, quoteRequests, confirmedOrders] = await Promise.all([
    ClaritySnapshot.find({
      snapshotType: 'devices',
      snapshotDate: { $gte: period.start, $lte: period.end },
    }).sort({ snapshotDate: 1 }).lean(),
    QuotationRequest.countDocuments({
      createdAt: { $gte: period.start, $lte: period.end },
    }),
    Task.countDocuments({
      createdAt: { $gte: period.start, $lte: period.end },
      paymentStatus: { $ne: 'Failed' },
      createdByType: 'public',
    }),
  ]);

  const sessionTotals = {
    mobile: 0,
    desktop: 0,
    tablet: 0,
    other: 0,
  };

  for (const snapshot of deviceSnapshots) {
    const dayTotals = extractDeviceSessions(snapshot.data);
    for (const key of Object.keys(sessionTotals)) {
      sessionTotals[key] += dayTotals[key] || 0;
    }
  }

  const devices = buildDeviceBreakdown(sessionTotals);
  const totalSessions = devices.reduce((sum, device) => sum + device.sessions, 0);
  const siteWideConversion = totalSessions > 0
    ? roundPercent((confirmedOrders / totalSessions) * 100)
    : 0;

  return {
    period: {
      preset: period.preset,
      startDate: toDateString(period.start),
      endDate: toDateString(period.end),
    },
    snapshotCoverage: {
      daysInPeriod: deviceSnapshots.length,
      note: deviceSnapshots.length === 0
        ? 'No device snapshots for this period. Data appears as daily Clarity sync runs.'
        : undefined,
    },
    devices,
    totals: {
      sessions: totalSessions,
      quoteRequests,
      confirmedOrders,
    },
    siteWideConversion: {
      value: siteWideConversion,
      formatted: `${siteWideConversion}%`,
      detail: 'Confirmed orders ÷ total sessions (all devices combined)',
      applicable: totalSessions > 0,
    },
    dataSources: {
      sessions: 'Clarity devices snapshots — sessions grouped as Mobile, Desktop (PC), Tablet',
      conversionByDevice: 'Not available — quotes and orders do not store device type yet',
    },
  };
}

module.exports = {
  getDevices,
};
