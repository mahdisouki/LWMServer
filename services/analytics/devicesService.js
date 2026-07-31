const QuotationRequest = require('../../models/QuotationRequest');
const Task = require('../../models/Task');
const { resolvePeriod } = require('./dashboardService');
const { getPeriodLabels } = require('../../utils/analyticsDateRange');
const { isGa4Enabled } = require('../../config/ga4Config');
const { fetchSessionsByDeviceCategory } = require('./ga4Service');
const { excludeMigratedOrdersFilter } = require('./taskFilters');

const DEVICE_BUCKETS = [
  { id: 'mobile', label: 'Mobile', color: 'blue' },
  { id: 'desktop', label: 'Desktop', color: 'green' },
  { id: 'tablet', label: 'Tablet', color: 'orange' },
];

function roundPercent(value) {
  return Math.round(value * 100) / 100;
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

  if (!isGa4Enabled()) {
    throw new Error('GA4 is not configured — Devices requires Google Analytics 4');
  }

  const [ga4Devices, quoteRequests, confirmedOrders] = await Promise.all([
    fetchSessionsByDeviceCategory({
      startKey: period.startKey,
      endKey: period.endKey,
    }),
    QuotationRequest.countDocuments({
      createdAt: { $gte: period.start, $lte: period.end },
    }),
    Task.countDocuments({
      createdAt: { $gte: period.start, $lte: period.end },
      paymentStatus: { $ne: 'Failed' },
      createdByType: 'public',
      ...excludeMigratedOrdersFilter,
    }),
  ]);

  if (!ga4Devices?.available) {
    throw new Error('Failed to load device sessions from Google Analytics 4');
  }

  const sessionTotals = {
    mobile: ga4Devices.sessions.mobile || 0,
    desktop: ga4Devices.sessions.desktop || 0,
    tablet: ga4Devices.sessions.tablet || 0,
    other: ga4Devices.sessions.other || 0,
  };

  const devices = buildDeviceBreakdown(sessionTotals);
  const totalSessions = devices.reduce((sum, device) => sum + device.sessions, 0);
  const siteWideConversion = totalSessions > 0
    ? roundPercent((confirmedOrders / totalSessions) * 100)
    : 0;

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    snapshotCoverage: {
      daysInPeriod: null,
      trafficSource: 'ga4',
      note: undefined,
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
      sessions: 'Google Analytics 4 — sessions by deviceCategory (mobile, desktop, tablet)',
      conversionByDevice: 'Not available — quotes and orders do not store device type yet',
    },
  };
}

module.exports = {
  getDevices,
};
