const QuotationRequest = require('../../models/QuotationRequest');
const ContactRequest = require('../../models/ContactRequest');
const { resolvePeriod } = require('./dashboardService');
const {
  ANALYTICS_TIMEZONE,
  toDateString,
  eachDayKeyInPeriod,
  getPeriodLabels,
} = require('../../utils/analyticsDateRange');

const GOAL_TYPES = [
  { id: 'quoteRequests', label: 'Quote Requests', color: 'orange' },
  { id: 'contactForms', label: 'Contact Forms', color: 'blue' },
];

async function countByDay(Model, start, end) {
  const rows = await Model.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$createdAt',
            timezone: ANALYTICS_TIMEZONE,
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return new Map(rows.map((row) => [row._id, row.count]));
}

function buildDailySeries(start, end, quoteByDay, contactByDay, period = {}) {
  return eachDayKeyInPeriod(start, end, {
    startKey: period.startKey,
    endKey: period.endKey,
  }).map((date) => ({
    date,
    quoteRequests: quoteByDay.get(date) || 0,
    contactForms: contactByDay.get(date) || 0,
  }));
}

async function getGoalCompletions({ preset, startDate, endDate } = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });

  const [quoteByDay, contactByDay] = await Promise.all([
    countByDay(QuotationRequest, period.start, period.end),
    countByDay(ContactRequest, period.start, period.end),
  ]);

  const daily = buildDailySeries(period.start, period.end, quoteByDay, contactByDay, period);

  const totals = daily.reduce(
    (acc, day) => ({
      quoteRequests: acc.quoteRequests + day.quoteRequests,
      contactForms: acc.contactForms + day.contactForms,
    }),
    { quoteRequests: 0, contactForms: 0 },
  );

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    goalTypes: GOAL_TYPES,
    daily,
    totals,
    dataSources: {
      quoteRequests: 'QuotationRequest collection — quote form submissions per day',
      contactForms: 'ContactRequest collection — contact form submissions per day',
    },
  };
}

module.exports = {
  getGoalCompletions,
};
