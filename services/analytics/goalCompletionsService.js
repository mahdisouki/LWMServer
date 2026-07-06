const QuotationRequest = require('../../models/QuotationRequest');
const ContactRequest = require('../../models/ContactRequest');
const { resolvePeriod } = require('./dashboardService');

const GOAL_TYPES = [
  { id: 'quoteRequests', label: 'Quote Requests', color: 'orange' },
  { id: 'contactForms', label: 'Contact Forms', color: 'blue' },
];

function startOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function toDateString(date) {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

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
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return new Map(rows.map((row) => [row._id, row.count]));
}

function buildDailySeries(start, end, quoteByDay, contactByDay) {
  const daily = [];
  const cursor = startOfUtcDay(start);
  const endDay = startOfUtcDay(end);

  while (cursor <= endDay) {
    const date = toDateString(cursor);
    daily.push({
      date,
      quoteRequests: quoteByDay.get(date) || 0,
      contactForms: contactByDay.get(date) || 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return daily;
}

async function getGoalCompletions({ preset, startDate, endDate } = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });

  const [quoteByDay, contactByDay] = await Promise.all([
    countByDay(QuotationRequest, period.start, period.end),
    countByDay(ContactRequest, period.start, period.end),
  ]);

  const daily = buildDailySeries(period.start, period.end, quoteByDay, contactByDay);

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
      startDate: toDateString(period.start),
      endDate: toDateString(period.end),
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
