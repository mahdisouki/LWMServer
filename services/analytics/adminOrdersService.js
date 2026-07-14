const Task = require('../../models/Task');
const { resolvePeriod } = require('./dashboardService');
const { getPeriodLabels, eachDayKeyInPeriod } = require('../../utils/analyticsDateRange');

const ADMIN_COLORS = [
  'blue', 'green', 'purple', 'orange', 'pink', 'cyan', 'amber', 'indigo',
  'teal', 'lime', 'rose', 'violet', 'sky', 'emerald', 'fuchsia', 'red',
];

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function normalizeAdminLabel(createdBy) {
  const label = String(createdBy || '').trim();
  return label || 'Unknown';
}

const ADMIN_ORDER_MATCH = (start, end) => ({
  createdAt: { $gte: start, $lte: end },
  createdByType: 'Admin',
  paymentStatus: { $ne: 'Failed' },
});

function buildDailyMap(dailyRows) {
  const byDate = new Map();

  for (const row of dailyRows) {
    const dateKey = row._id.date;
    const admin = normalizeAdminLabel(row._id.admin);

    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, {
        date: dateKey,
        orderCount: 0,
        totalValue: 0,
        admins: [],
      });
    }

    const day = byDate.get(dateKey);
    day.orderCount += row.orderCount;
    day.totalValue = roundMoney(day.totalValue + row.totalValue);
    day.admins.push({
      admin,
      orderCount: row.orderCount,
      totalValue: roundMoney(row.totalValue),
    });
  }

  return byDate;
}

async function aggregateAdminOrderStats(start, end) {
  const [result] = await Task.aggregate([
    { $match: ADMIN_ORDER_MATCH(start, end) },
    {
      $facet: {
        byAdmin: [
          {
            $group: {
              _id: '$createdBy',
              orderCount: { $sum: 1 },
              totalValue: { $sum: '$totalPrice' },
            },
          },
          { $sort: { orderCount: -1, totalValue: -1, _id: 1 } },
        ],
        byDayAndAdmin: [
          {
            $group: {
              _id: {
                date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                admin: '$createdBy',
              },
              orderCount: { $sum: 1 },
              totalValue: { $sum: '$totalPrice' },
            },
          },
          { $sort: { '_id.date': 1, orderCount: -1 } },
        ],
      },
    },
  ]);

  return {
    adminRows: result?.byAdmin || [],
    dailyRows: result?.byDayAndAdmin || [],
  };
}

function buildAdminSegments(rows) {
  const totals = rows.reduce(
    (acc, row) => ({
      orderCount: acc.orderCount + row.orderCount,
      totalValue: acc.totalValue + row.totalValue,
    }),
    { orderCount: 0, totalValue: 0 },
  );

  const segments = rows.map((row, index) => {
    const admin = normalizeAdminLabel(row._id);
    const totalValue = roundMoney(row.totalValue);

    return {
      rank: index + 1,
      admin,
      orderCount: row.orderCount,
      totalValue,
      orderSharePercent: totals.orderCount > 0
        ? roundPercent((row.orderCount / totals.orderCount) * 100)
        : 0,
      valueSharePercent: totals.totalValue > 0
        ? roundPercent((row.totalValue / totals.totalValue) * 100)
        : 0,
      color: ADMIN_COLORS[index % ADMIN_COLORS.length],
    };
  });

  return {
    segments,
    totals: {
      orderCount: totals.orderCount,
      totalValue: roundMoney(totals.totalValue),
      admins: segments.length,
    },
  };
}

function buildDailySeries(period, dailyMap) {
  const dayKeys = eachDayKeyInPeriod(period.start, period.end, period);

  return dayKeys.map((date) => {
    const day = dailyMap.get(date);
    return day || {
      date,
      orderCount: 0,
      totalValue: 0,
      admins: [],
    };
  });
}

async function getAdminOrders({
  preset,
  startDate,
  endDate,
} = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });

  const { adminRows, dailyRows } = await aggregateAdminOrderStats(
    period.start,
    period.end,
  );

  const { segments, totals } = buildAdminSegments(adminRows);
  const dailyBreakdown = buildDailySeries(period, buildDailyMap(dailyRows));

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    segments,
    totals,
    dailyBreakdown,
    chartHints: {
      orderCountDonut: 'Use segments[].admin as label, segments[].orderCount as value, segments[].orderSharePercent as share',
      valueDonut: 'Use segments[].admin as label, segments[].totalValue as value, segments[].valueSharePercent as share',
      colors: 'Use segments[].color for consistent slice colors',
    },
    dataSources: {
      orders: 'Task collection — admin-created orders (createdByType Admin), excluding Failed payments',
      grouping: 'Grouped by createdBy (admin username)',
      dateFilter: 'Filtered by order creation timestamp (Task.createdAt)',
    },
  };
}

module.exports = {
  getAdminOrders,
};
