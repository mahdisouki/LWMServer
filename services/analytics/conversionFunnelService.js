const Task = require('../../models/Task');
const QuotationRequest = require('../../models/QuotationRequest');
const ContactRequest = require('../../models/ContactRequest');
const MovingServiceRequest = require('../../models/MovingServiceRequest');
const { resolvePeriod } = require('./dashboardService');
const { getPeriodLabels } = require('../../utils/analyticsDateRange');
const { isGa4Enabled } = require('../../config/ga4Config');
const { fetchPeriodTraffic, fetchTrafficByChannel } = require('./ga4Service');
const { excludeMigratedOrdersFilter } = require('./taskFilters');

const FUNNEL_STAGES = [
  { id: 'visitors', label: 'Website Visitors', expandable: true, expandKind: 'ga4Visitors' },
  {
    id: 'pageEngagements',
    label: 'Page Engagements',
    expandable: true,
    expandKind: 'ga4Sessions',
  },
  { id: 'leadRequests', label: 'Requests', expandable: true, expandKind: 'leads', showPercentOfTop: false },
  {
    id: 'ordersRevenue',
    label: 'Orders & Revenue',
    expandable: true,
    expandKind: 'orders',
  },
];

const LEAD_BREAKDOWN_LABELS = {
  quoteRequests: 'Quote Requests',
  contactRequests: 'Contact Requests',
  movingServiceRequests: 'Moving Service Requests',
};

const ORDER_ORIGIN_META = {
  public: { id: 'public', label: 'Public', color: 'green' },
  Admin: { id: 'admin', label: 'Admin', color: 'orange' },
  broker: { id: 'broker', label: 'Broker', color: 'purple' },
};

const CHANNEL_COLORS = [
  'blue', 'purple', 'green', 'orange', 'pink', 'cyan', 'indigo', 'amber',
];

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function statusStat(count, total) {
  return {
    count,
    percent: total > 0 ? roundPercent((count / total) * 100) : 0,
  };
}

function slugifyChannel(channel) {
  return String(channel || 'unassigned')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'unassigned';
}

function buildChannelSourceBreakdown(channels, metricKey) {
  const rows = (channels || [])
    .map((row) => ({
      channel: row.channel,
      count: row[metricKey] || 0,
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.channel.localeCompare(b.channel));

  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return rows.map((row, index) => ({
    id: slugifyChannel(row.channel),
    label: row.channel,
    count: row.count,
    sharePercent: total > 0 ? roundPercent((row.count / total) * 100) : 0,
    color: CHANNEL_COLORS[index % CHANNEL_COLORS.length],
  }));
}

async function countContactRequests(start, end) {
  return ContactRequest.countDocuments({
    createdAt: { $gte: start, $lte: end },
  });
}

async function countMovingServiceRequests(start, end) {
  return MovingServiceRequest.countDocuments({
    createdAt: { $gte: start, $lte: end },
  });
}

async function countQuoteRequests(start, end) {
  return QuotationRequest.countDocuments({
    createdAt: { $gte: start, $lte: end },
  });
}

/**
 * Quotation status matches QuotationRequest.getStatusSync:
 * accepted = reason === 'task created'
 * rejected = any other non-empty reason
 * pending = no reason
 */
async function loadQuotationStats(start, end) {
  const rows = await QuotationRequest.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: {
          $switch: {
            branches: [
              {
                case: { $eq: ['$reason', 'task created'] },
                then: 'accepted',
              },
              {
                case: {
                  $and: [
                    { $ne: [{ $ifNull: ['$reason', ''] }, ''] },
                    { $ne: [{ $trim: { input: { $ifNull: ['$reason', ''] } } }, ''] },
                  ],
                },
                then: 'rejected',
              },
            ],
            default: 'pending',
          },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  const counts = { accepted: 0, rejected: 0, pending: 0 };
  for (const row of rows) {
    if (row._id && Object.prototype.hasOwnProperty.call(counts, row._id)) {
      counts[row._id] = row.count || 0;
    }
  }

  const total = counts.accepted + counts.rejected + counts.pending;

  return {
    total,
    accepted: statusStat(counts.accepted, total),
    rejected: statusStat(counts.rejected, total),
    pending: statusStat(counts.pending, total),
  };
}

async function loadOrdersByOrigin(start, end) {
  const rows = await Task.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        paymentStatus: { $ne: 'Failed' },
        createdByType: { $in: ['public', 'Admin', 'broker'] },
        ...excludeMigratedOrdersFilter,
      },
    },
    {
      $group: {
        _id: '$createdByType',
        orders: { $sum: 1 },
        revenue: { $sum: { $ifNull: ['$totalPrice', 0] } },
      },
    },
  ]);

  const byOrigin = {
    public: { orders: 0, revenue: 0 },
    admin: { orders: 0, revenue: 0 },
    broker: { orders: 0, revenue: 0 },
  };

  for (const row of rows) {
    if (row._id === 'public') {
      byOrigin.public = {
        orders: row.orders || 0,
        revenue: roundMoney(row.revenue || 0),
      };
    } else if (row._id === 'Admin') {
      byOrigin.admin = {
        orders: row.orders || 0,
        revenue: roundMoney(row.revenue || 0),
      };
    } else if (row._id === 'broker') {
      byOrigin.broker = {
        orders: row.orders || 0,
        revenue: roundMoney(row.revenue || 0),
      };
    }
  }

  const totalOrders =
    byOrigin.public.orders + byOrigin.admin.orders + byOrigin.broker.orders;
  const totalRevenue = roundMoney(
    byOrigin.public.revenue + byOrigin.admin.revenue + byOrigin.broker.revenue,
  );

  const orderOriginBreakdown = ['public', 'Admin', 'broker'].map((key) => {
    const meta = ORDER_ORIGIN_META[key];
    const stats = byOrigin[meta.id];
    return {
      id: meta.id,
      label: meta.label,
      orders: stats.orders,
      revenue: stats.revenue,
      sharePercent: totalOrders > 0 ? roundPercent((stats.orders / totalOrders) * 100) : 0,
      color: meta.color,
    };
  });

  return {
    publicOrders: byOrigin.public.orders,
    publicRevenue: byOrigin.public.revenue,
    adminOrders: byOrigin.admin.orders,
    adminRevenue: byOrigin.admin.revenue,
    brokerOrders: byOrigin.broker.orders,
    brokerRevenue: byOrigin.broker.revenue,
    totalOrders,
    totalRevenue,
    orderOriginBreakdown,
  };
}

function buildLeadBreakdown(counts) {
  return ['quoteRequests', 'contactRequests', 'movingServiceRequests'].map((id) => ({
    id,
    label: LEAD_BREAKDOWN_LABELS[id],
    count: counts[id] || 0,
  }));
}

function buildFunnelSteps(
  counts,
  quotationStats,
  channelTraffic,
  orderStats,
  { includeChannels = false, includeLeadDetails = false } = {},
) {
  const top = counts.visitors || 0;
  const channels = channelTraffic?.channels || [];

  const steps = FUNNEL_STAGES.map((stage, index) => {
    const count = counts[stage.id] || 0;
    const showPercentOfTop = stage.showPercentOfTop !== false;
    const percentOfTop = showPercentOfTop && top > 0
      ? roundPercent((count / top) * 100)
      : null;
    const previousCount = index > 0 ? counts[FUNNEL_STAGES[index - 1].id] || 0 : null;
    const dropOffFromPrevious = previousCount && previousCount > 0 && showPercentOfTop
      ? roundPercent(((previousCount - count) / previousCount) * 100)
      : null;

    const step = {
      id: stage.id,
      label: stage.label,
      count,
      valueType: stage.valueType || 'count',
      percentOfTop,
      dropOffFromPrevious,
    };

    if (stage.expandable) {
      step.expandable = true;
      step.expandKind = stage.expandKind;

      if (stage.expandKind === 'leads') {
        step.breakdown = buildLeadBreakdown(counts);
        step.expandHint = 'Quotes, contact & moving';
        if (includeLeadDetails && quotationStats) {
          step.quotationStats = quotationStats;
        }
      } else if (stage.expandKind === 'ga4Visitors') {
        step.expandHint = 'By GA4 channel';
        if (includeChannels) {
          step.sourceBreakdown = buildChannelSourceBreakdown(channels, 'users');
        }
      } else if (stage.expandKind === 'ga4Sessions') {
        step.expandHint = 'Engaged sessions by GA4 channel';
        if (includeChannels) {
          step.sourceBreakdown = buildChannelSourceBreakdown(channels, 'engagedSessions');
        }
      } else if (stage.expandKind === 'orders') {
        step.orderOriginBreakdown = orderStats.orderOriginBreakdown;
        step.totalRevenue = orderStats.totalRevenue;
        step.expandHint = `Total revenue £${orderStats.totalRevenue.toLocaleString('en-GB', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        })} · Public, admin & broker`;
      }
    }

    return step;
  });

  const overallConversion = top > 0
    ? roundPercent((counts.publicOrders / top) * 100)
    : 0;

  return { steps, overallConversion };
}

function parseBoolFlag(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return false;
}

async function getConversionFunnel({
  preset,
  startDate,
  endDate,
  includeChannels,
  includeLeadDetails,
} = {}) {
  const period = resolvePeriod({ preset, startDate, endDate });
  const withChannels = parseBoolFlag(includeChannels);
  const withLeadDetails = parseBoolFlag(includeLeadDetails);

  if (!isGa4Enabled()) {
    throw new Error('GA4 is not configured — Conversion Funnel requires Google Analytics 4');
  }

  const quotePromise = withLeadDetails
    ? loadQuotationStats(period.start, period.end)
    : countQuoteRequests(period.start, period.end).then((total) => ({ total }));

  const channelPromise = withChannels
    ? fetchTrafficByChannel({ startKey: period.startKey, endKey: period.endKey, limit: 8 })
    : Promise.resolve({ channels: [], available: true });

  const [
    quotationResult,
    contactRequests,
    movingServiceRequests,
    orderStats,
    ga4Period,
    channelTraffic,
  ] = await Promise.all([
    quotePromise,
    countContactRequests(period.start, period.end),
    countMovingServiceRequests(period.start, period.end),
    loadOrdersByOrigin(period.start, period.end),
    fetchPeriodTraffic({ startKey: period.startKey, endKey: period.endKey }),
    channelPromise,
  ]);

  if (!ga4Period?.available) {
    throw new Error('Failed to load visitor metrics from Google Analytics 4');
  }

  const quotationStats = withLeadDetails ? quotationResult : null;
  const quoteRequests = withLeadDetails
    ? quotationResult.total
    : quotationResult.total;

  const counts = {
    visitors: ga4Period.users,
    pageEngagements: ga4Period.engagedSessions ?? 0,
    quoteRequests,
    contactRequests,
    movingServiceRequests,
    leadRequests: quoteRequests + contactRequests + movingServiceRequests,
    ordersRevenue: orderStats.totalOrders,
    publicOrders: orderStats.publicOrders,
  };

  const { steps, overallConversion } = buildFunnelSteps(
    counts,
    quotationStats,
    channelTraffic?.available ? channelTraffic : { channels: [] },
    orderStats,
    { includeChannels: withChannels, includeLeadDetails: withLeadDetails },
  );

  return {
    period: {
      preset: period.preset,
      ...getPeriodLabels(period),
    },
    snapshotCoverage: {
      daysInPeriod: null,
      trafficSource: 'ga4',
    },
    funnel: steps,
    overallConversion,
    details: {
      channels: withChannels,
      leadDetails: withLeadDetails,
    },
    dataSources: {
      visitors: 'Google Analytics 4 — totalUsers for the selected period',
      visitorSources:
        'Google Analytics 4 — totalUsers by sessionDefaultChannelGroup (loaded on expand)',
      pageEngagements: 'Google Analytics 4 — engagedSessions',
      pageEngagementSources:
        'Google Analytics 4 — engagedSessions by sessionDefaultChannelGroup (loaded on expand)',
      leadRequests:
        'Sum of QuotationRequest + ContactRequest + MovingServiceRequest submissions in period',
      quoteRequests: 'QuotationRequest collection',
      contactRequests: 'ContactRequest collection — contact form submissions in period',
      movingServiceRequests: 'MovingServiceRequest collection — moving service form submissions in period',
      quotationStats:
        'QuotationRequest status derived from reason (loaded on Requests expand)',
      ordersRevenue:
        'Task collection — public + Admin + broker bookings with paymentStatus not Failed, excluding createdBy MigrationScript, created in period',
      publicOrders: 'createdByType public',
      adminOrders: 'createdByType Admin',
      brokerOrders: 'createdByType broker',
      overallConversion: 'Public orders ÷ website visitors (GA4 totalUsers)',
    },
  };
}

module.exports = {
  getConversionFunnel,
};
