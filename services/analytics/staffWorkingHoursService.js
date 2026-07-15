const Payroll = require('../../models/Payroll');
const { resolvePeriod } = require('./dashboardService');
const { getPeriodLabels, eachDayKeyInPeriod } = require('../../utils/analyticsDateRange');

const STAFF_COLORS = [
  'blue', 'green', 'purple', 'orange', 'pink', 'cyan', 'amber', 'indigo',
  'teal', 'lime', 'rose', 'violet', 'sky', 'emerald', 'fuchsia', 'red',
];

function roundHours(value) {
  return Math.round(value * 100) / 100;
}

const COMPLETED_SHIFT_MATCH = (start, end) => ({
  startTime: { $gte: start, $lte: end },
  endTime: { $exists: true, $ne: null },
  totalHoursWorked: { $gt: 0 },
});

const USER_LOOKUP_STAGES = [
  {
    $lookup: {
      from: 'users',
      localField: '_id',
      foreignField: '_id',
      as: 'user',
    },
  },
  { $unwind: '$user' },
  {
    $match: {
      'user.roleType': { $in: ['Driver', 'Helper'] },
    },
  },
];

function buildStaffSegment(row, index, roleTotals) {
  const username = row.username || 'Unknown';
  const avgHoursPerShift = roundHours(row.avgHoursPerShift);
  const totalHours = roundHours(row.totalHours);

  return {
    rank: index + 1,
    userId: row.userId,
    username,
    roleType: row.roleType,
    shiftCount: row.shiftCount,
    totalHours,
    avgHoursPerShift,
    avgRegularHours: roundHours(row.avgRegularHours),
    avgExtraHours: roundHours(row.avgExtraHours),
    hoursSharePercent: roleTotals.totalHours > 0
      ? roundHours((row.totalHours / roleTotals.totalHours) * 100)
      : 0,
    color: STAFF_COLORS[index % STAFF_COLORS.length],
  };
}

function buildRoleGroup(rows, roleType) {
  const roleRows = rows
    .filter((row) => row.roleType === roleType)
    .sort((a, b) => b.avgHoursPerShift - a.avgHoursPerShift || b.totalHours - a.totalHours);

  const totals = roleRows.reduce(
    (acc, row) => ({
      shiftCount: acc.shiftCount + row.shiftCount,
      totalHours: acc.totalHours + row.totalHours,
    }),
    { shiftCount: 0, totalHours: 0 },
  );

  totals.totalHours = roundHours(totals.totalHours);
  const avgHoursPerShift = totals.shiftCount > 0
    ? roundHours(totals.totalHours / totals.shiftCount)
    : 0;

  const segments = roleRows.map((row, index) => buildStaffSegment(row, index, totals));

  return {
    segments,
    totals: {
      staffCount: segments.length,
      shiftCount: totals.shiftCount,
      totalHours: totals.totalHours,
      avgHoursPerShift,
    },
  };
}

function buildDailyMap(dailyRows) {
  const byDate = new Map();

  for (const row of dailyRows) {
    const dateKey = row._id.date;
    const roleType = row._id.roleType;

    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, {
        date: dateKey,
        shiftCount: 0,
        totalHours: 0,
        drivers: { shiftCount: 0, totalHours: 0 },
        helpers: { shiftCount: 0, totalHours: 0 },
      });
    }

    const day = byDate.get(dateKey);
    const hours = roundHours(row.totalHours);
    day.shiftCount += row.shiftCount;
    day.totalHours = roundHours(day.totalHours + hours);

    const roleKey = roleType === 'Driver' ? 'drivers' : 'helpers';
    day[roleKey].shiftCount += row.shiftCount;
    day[roleKey].totalHours = roundHours(day[roleKey].totalHours + hours);
  }

  return byDate;
}

function buildDailySeries(period, dailyMap) {
  const dayKeys = eachDayKeyInPeriod(period.start, period.end, period);

  return dayKeys.map((date) => {
    const day = dailyMap.get(date);
    if (!day) {
      return {
        date,
        shiftCount: 0,
        totalHours: 0,
        avgHoursPerShift: 0,
        drivers: { shiftCount: 0, totalHours: 0, avgHoursPerShift: 0 },
        helpers: { shiftCount: 0, totalHours: 0, avgHoursPerShift: 0 },
      };
    }

    return {
      ...day,
      avgHoursPerShift: day.shiftCount > 0
        ? roundHours(day.totalHours / day.shiftCount)
        : 0,
      drivers: {
        ...day.drivers,
        avgHoursPerShift: day.drivers.shiftCount > 0
          ? roundHours(day.drivers.totalHours / day.drivers.shiftCount)
          : 0,
      },
      helpers: {
        ...day.helpers,
        avgHoursPerShift: day.helpers.shiftCount > 0
          ? roundHours(day.helpers.totalHours / day.helpers.shiftCount)
          : 0,
      },
    };
  });
}

async function aggregateStaffWorkingHours(start, end) {
  const [result] = await Payroll.aggregate([
    { $match: COMPLETED_SHIFT_MATCH(start, end) },
    {
      $facet: {
        byStaff: [
          {
            $group: {
              _id: '$userId',
              shiftCount: { $sum: 1 },
              totalHours: { $sum: '$totalHoursWorked' },
              avgHoursPerShift: { $avg: '$totalHoursWorked' },
              avgRegularHours: { $avg: '$regularHours' },
              avgExtraHours: { $avg: '$extraHours' },
            },
          },
          ...USER_LOOKUP_STAGES,
          {
            $project: {
              _id: 0,
              userId: '$_id',
              username: '$user.username',
              roleType: '$user.roleType',
              shiftCount: 1,
              totalHours: 1,
              avgHoursPerShift: 1,
              avgRegularHours: 1,
              avgExtraHours: 1,
            },
          },
        ],
        byDayAndRole: [
          {
            $group: {
              _id: {
                date: { $dateToString: { format: '%Y-%m-%d', date: '$startTime' } },
                userId: '$userId',
              },
              shiftCount: { $sum: 1 },
              totalHours: { $sum: '$totalHoursWorked' },
            },
          },
          {
            $lookup: {
              from: 'users',
              localField: '_id.userId',
              foreignField: '_id',
              as: 'user',
            },
          },
          { $unwind: '$user' },
          {
            $match: {
              'user.roleType': { $in: ['Driver', 'Helper'] },
            },
          },
          {
            $group: {
              _id: {
                date: '$_id.date',
                roleType: '$user.roleType',
              },
              shiftCount: { $sum: '$shiftCount' },
              totalHours: { $sum: '$totalHours' },
            },
          },
          { $sort: { '_id.date': 1 } },
        ],
      },
    },
  ]);

  return {
    staffRows: result?.byStaff || [],
    dailyRows: result?.byDayAndRole || [],
  };
}

async function getStaffWorkingHours({
  preset,
  startDate,
  endDate,
} = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });

  const { staffRows, dailyRows } = await aggregateStaffWorkingHours(
    period.start,
    period.end,
  );

  const drivers = buildRoleGroup(staffRows, 'Driver');
  const helpers = buildRoleGroup(staffRows, 'Helper');
  const dailyBreakdown = buildDailySeries(period, buildDailyMap(dailyRows));

  const combinedShiftCount = drivers.totals.shiftCount + helpers.totals.shiftCount;
  const combinedTotalHours = roundHours(
    drivers.totals.totalHours + helpers.totals.totalHours,
  );

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    drivers,
    helpers,
    totals: {
      staffCount: drivers.totals.staffCount + helpers.totals.staffCount,
      shiftCount: combinedShiftCount,
      totalHours: combinedTotalHours,
      avgHoursPerShift: combinedShiftCount > 0
        ? roundHours(combinedTotalHours / combinedShiftCount)
        : 0,
    },
    dailyBreakdown,
    chartHints: {
      driverBarChart: 'Use drivers.segments[].username as label, drivers.segments[].avgHoursPerShift as value',
      helperBarChart: 'Use helpers.segments[].username as label, helpers.segments[].avgHoursPerShift as value',
      colors: 'Use segments[].color for consistent bar colors',
    },
    dataSources: {
      payroll: 'Payroll collection — completed shifts only (endTime set, totalHoursWorked > 0)',
      grouping: 'Grouped by userId; split into Driver and Helper via User.roleType',
      dateFilter: 'Filtered by shift start timestamp (Payroll.startTime)',
      avgHoursPerShift: 'Average of totalHoursWorked across completed shifts in the selected period',
    },
  };
}

module.exports = {
  getStaffWorkingHours,
};
