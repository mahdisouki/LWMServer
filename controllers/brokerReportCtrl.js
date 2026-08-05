const BrokerLead = require('../models/BrokerLead');
const BrokerQuoteRequest = require('../models/BrokerQuoteRequest');
const BrokerNegotiation = require('../models/BrokerNegotiation');
const BrokerOrder = require('../models/BrokerOrder');
const BrokerTask = require('../models/BrokerTask');
const BrokerDocument = require('../models/BrokerDocument');
const { resolveBrokerIdForUser } = require('../utils/brokerScope');

function getDateRange(query = {}) {
  const now = new Date();
  const to = query.to ? new Date(query.to) : now;
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getFullYear(), to.getMonth(), to.getDate() - 29);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fillMonthSeries(from, to, sourceMap) {
  const out = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cursor <= end) {
    const key = monthKey(cursor);
    out.push({
      month: key,
      leads: sourceMap[key]?.leads || 0,
      orders: sourceMap[key]?.orders || 0,
      revenue: sourceMap[key]?.revenue || 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

async function buildReportForBroker(brokerId, from, to) {
  const createdMatch = { brokerId, createdAt: { $gte: from, $lte: to } };
  const leadPeriodMatch = { brokerId, updatedAt: { $gte: from, $lte: to }, status: 'Converted' };

  const [
    leadsCreated,
    quotesCreated,
    negotiationsCreated,
    ordersCreated,
    tasksCreated,
    documentsUploaded,
    convertedInPeriod,
    taskCompletedInPeriod,
    revenueAgg,
    activePipelineAgg,
    leadStatusDist,
    taskStatusDist,
    docTypeDist,
    topCompanies,
    leadTrends,
    orderTrends,
  ] = await Promise.all([
    BrokerLead.countDocuments(createdMatch),
    BrokerQuoteRequest.countDocuments(createdMatch),
    BrokerNegotiation.countDocuments(createdMatch),
    BrokerOrder.countDocuments(createdMatch),
    BrokerTask.countDocuments(createdMatch),
    BrokerDocument.countDocuments(createdMatch),
    BrokerLead.countDocuments(leadPeriodMatch),
    BrokerTask.countDocuments({
      brokerId,
      completedAt: { $gte: from, $lte: to },
      status: 'Completed',
    }),
    BrokerOrder.aggregate([
      { $match: createdMatch },
      {
        $group: {
          _id: null,
          revenue: {
            $sum: {
              $cond: [
                { $in: ['$status', ['Confirmed', 'InProgress', 'Completed']] },
                '$orderAmount',
                0,
              ],
            },
          },
        },
      },
    ]),
    BrokerLead.aggregate([
      {
        $match: {
          brokerId,
          status: { $nin: ['Converted', 'Lost'] },
        },
      },
      { $group: { _id: null, pipeline: { $sum: '$pipelineValue' } } },
    ]),
    BrokerLead.aggregate([
      { $match: { brokerId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    BrokerTask.aggregate([
      { $match: { brokerId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    BrokerDocument.aggregate([
      { $match: { brokerId } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
    BrokerOrder.aggregate([
      {
        $match: {
          ...createdMatch,
          status: { $in: ['Confirmed', 'InProgress', 'Completed'] },
        },
      },
      {
        $group: {
          _id: '$companyName',
          revenue: { $sum: '$orderAmount' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]),
    BrokerLead.aggregate([
      { $match: createdMatch },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          leads: { $sum: 1 },
        },
      },
    ]),
    BrokerOrder.aggregate([
      { $match: createdMatch },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          orders: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [
                { $in: ['$status', ['Confirmed', 'InProgress', 'Completed']] },
                '$orderAmount',
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const revenue = Math.round(revenueAgg[0]?.revenue || 0);
  const activePipelineValue = Math.round(activePipelineAgg[0]?.pipeline || 0);
  const conversionRate = leadsCreated > 0 ? Math.round((convertedInPeriod / leadsCreated) * 1000) / 10 : 0;
  const avgOrderValue = ordersCreated > 0 ? Math.round(revenue / Math.max(ordersCreated, 1)) : 0;

  const trendsMap = {};
  for (const row of leadTrends) {
    trendsMap[row._id] = { ...(trendsMap[row._id] || {}), leads: row.leads };
  }
  for (const row of orderTrends) {
    trendsMap[row._id] = {
      ...(trendsMap[row._id] || {}),
      orders: row.orders,
      revenue: Math.round(row.revenue || 0),
    };
  }

  return {
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
    overview: {
      leadsCreated,
      quotesCreated,
      negotiationsCreated,
      ordersCreated,
      tasksCreated,
      tasksCompleted: taskCompletedInPeriod,
      documentsUploaded,
      conversionRate,
      revenue,
      activePipelineValue,
      avgOrderValue,
    },
    distributions: {
      leadsByStatus: leadStatusDist.map((x) => ({ status: x._id, count: x.count })),
      tasksByStatus: taskStatusDist.map((x) => ({ status: x._id, count: x.count })),
      documentsByType: docTypeDist.map((x) => ({ type: x._id, count: x.count })),
    },
    topCompanies: topCompanies.map((x) => ({
      companyName: x._id,
      revenue: Math.round(x.revenue || 0),
      orders: x.orders || 0,
    })),
    trends: fillMonthSeries(from, to, trendsMap),
  };
}

const brokerReportCtrl = {
  getMine: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }
      const { from, to } = getDateRange(req.query);
      const report = await buildReportForBroker(brokerId, from, to);
      return res.json({ success: true, data: report });
    } catch (error) {
      console.error('getMine reports error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  getByBroker: async (req, res) => {
    try {
      const brokerId = req.params.id || req.params.brokerId;
      if (!brokerId) {
        return res.status(400).json({ success: false, message: 'brokerId is required' });
      }
      const { from, to } = getDateRange(req.query);
      const report = await buildReportForBroker(brokerId, from, to);
      return res.json({ success: true, data: report });
    } catch (error) {
      console.error('getByBroker reports error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },
};

module.exports = brokerReportCtrl;
