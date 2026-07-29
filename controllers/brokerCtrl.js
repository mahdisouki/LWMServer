const bcrypt = require('bcrypt');
const Broker = require('../models/Broker');
const BrokerLead = require('../models/BrokerLead');
const BrokerOrder = require('../models/BrokerOrder');
const BrokerContact = require('../models/BrokerContact');
const BrokerQuoteRequest = require('../models/BrokerQuoteRequest');
const BrokerNegotiation = require('../models/BrokerNegotiation');
const BrokerTask = require('../models/BrokerTask');
const BrokerDocument = require('../models/BrokerDocument');
const BrokerUser = require('../models/BrokerUser');
const Task = require('../models/Task');
const loggingService = require('../services/loggingService');
const { resolveCommissionAmount } = require('../utils/brokerCommission');
const { escapeRegex } = require('../utils/brokerHelpers');

async function nextBrokerCode() {
  const count = await Broker.countDocuments();
  let code;
  let attempts = 0;
  do {
    code = `BRK${String(count + 1 + attempts).padStart(3, '0')}`;
    attempts += 1;
  } while (await Broker.exists({ brokerCode: code }));
  return code;
}

function buildBrokerFilter(query = {}) {
  const filter = {};
  const { keyword, status, commissionType } = query;

  if (status && status !== 'all') {
    filter.status = status;
  }
  if (commissionType && commissionType !== 'all') {
    filter.commissionType = commissionType;
  }
  if (keyword && String(keyword).trim()) {
    const regex = new RegExp(escapeRegex(String(keyword).trim()), 'i');
    filter.$or = [
      { companyName: regex },
      { contactName: regex },
      { email: regex },
      { brokerCode: regex },
      { phone: regex },
    ];
  }
  return filter;
}

function getSort(query = {}) {
  const sortBy = query.sortBy || 'revenue';
  const sortDir = query.sortDir === 'asc' ? 1 : -1;
  // Default DB sort; revenue/orders/conv computed after aggregation
  const map = {
    name: { companyName: sortDir },
    createdAt: { createdAt: sortDir },
  };
  return { sortBy, sortDir, mongoSort: map[sortBy] || { createdAt: -1 } };
}

async function getOrderAggregatesByBroker(brokerIds, brokersById = {}) {
  if (!brokerIds.length) return {};

  const orders = await BrokerOrder.find({
    brokerId: { $in: brokerIds },
    status: { $nin: ['Cancelled', 'Draft'] },
  }).lean();

  const map = {};
  for (const order of orders) {
    const key = String(order.brokerId);
    if (!map[key]) {
      map[key] = { orders: 0, revenue: 0, commissionEarned: 0 };
    }
    const broker = brokersById[key];
    const revenue = Number(order.orderAmount) || 0;
    const commission = resolveCommissionAmount(broker, revenue, order.commissionAmount);
    map[key].orders += 1;
    map[key].revenue += revenue;
    map[key].commissionEarned += commission;
  }
  return map;
}

async function getLeadAggregatesByBroker(brokerIds) {
  if (!brokerIds.length) return {};

  const rows = await BrokerLead.aggregate([
    { $match: { brokerId: { $in: brokerIds } } },
    {
      $group: {
        _id: '$brokerId',
        prospects: { $sum: 1 },
        orders: {
          $sum: { $cond: [{ $eq: ['$status', 'Converted'] }, 1, 0] },
        },
        revenue: {
          $sum: {
            $cond: [{ $eq: ['$status', 'Converted'] }, '$pipelineValue', 0],
          },
        },
        pipelineValue: { $sum: '$pipelineValue' },
      },
    },
  ]);

  const map = {};
  for (const row of rows) {
    const prospects = row.prospects || 0;
    const orders = row.orders || 0;
    map[String(row._id)] = {
      prospects,
      orders,
      revenue: row.revenue || 0,
      pipelineValue: row.pipelineValue || 0,
      conversionRate: prospects > 0 ? Math.round((orders / prospects) * 1000) / 10 : 0,
    };
  }
  return map;
}

function attachMetrics(broker, leadMetrics = {}, orderMetrics = {}) {
  const lm = leadMetrics[String(broker._id)] || {
    prospects: 0,
    orders: 0,
    revenue: 0,
    pipelineValue: 0,
    conversionRate: 0,
  };
  const om = orderMetrics[String(broker._id)] || {
    orders: 0,
    revenue: 0,
    commissionEarned: 0,
  };

  return {
    ...broker,
    id: broker._id,
    prospects: lm.prospects,
    orders: om.orders,
    revenue: om.revenue,
    pipelineValue: lm.pipelineValue,
    conversionRate: lm.conversionRate,
    commissionEarned: om.commissionEarned,
  };
}

async function loadMetricsForBrokers(brokers) {
  const ids = brokers.map((b) => b._id);
  const brokersById = {};
  brokers.forEach((b) => {
    brokersById[String(b._id)] = b;
  });
  const [leadMetrics, orderMetrics] = await Promise.all([
    getLeadAggregatesByBroker(ids),
    getOrderAggregatesByBroker(ids, brokersById),
  ]);
  return { leadMetrics, orderMetrics };
}

function sortBrokersWithMetrics(list, sortBy, sortDir) {
  const dir = sortDir === 1 ? 1 : -1;
  const keyMap = {
    revenue: 'revenue',
    orders: 'orders',
    conversionRate: 'conversionRate',
    prospects: 'prospects',
    name: 'companyName',
  };
  const key = keyMap[sortBy] || 'revenue';
  return [...list].sort((a, b) => {
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    if (typeof av === 'string' && typeof bv === 'string') {
      return av.localeCompare(bv) * dir;
    }
    return (av - bv) * dir;
  });
}

const brokerCtrl = {
  createBroker: async (req, res) => {
    try {
      const {
        companyName,
        contactName,
        email,
        phone,
        address,
        commissionType,
        commissionValue,
        notes,
        status,
        createPortalUser,
        portalPassword,
      } = req.body;

      if (!companyName || !contactName || !email) {
        return res.status(400).json({
          success: false,
          message: 'companyName, contactName and email are required',
        });
      }

      const brokerCode = await nextBrokerCode();
      const broker = await Broker.create({
        companyName,
        brokerCode,
        contactName,
        email: String(email).toLowerCase().trim(),
        phone: phone || '',
        address: address || '',
        commissionType: commissionType || 'Percentage',
        commissionValue: commissionValue != null ? Number(commissionValue) : 10,
        notes: notes || '',
        status: status || 'Active',
      });

      if (createPortalUser) {
        if (!portalPassword || String(portalPassword).length < 6) {
          return res.status(400).json({
            success: false,
            message: 'portalPassword must be at least 6 characters when createPortalUser is true',
          });
        }

        const existing = await BrokerUser.findOne({ email: broker.email });
        if (existing) {
          return res.status(400).json({
            success: false,
            message: 'A portal user with this email already exists',
          });
        }

        const hashedPassword = await bcrypt.hash(portalPassword, 10);
        const username =
          String(contactName).trim().replace(/\s+/g, '.').toLowerCase() ||
          broker.brokerCode.toLowerCase();

        const portalUser = await BrokerUser.create({
          email: broker.email,
          username,
          firstName: contactName.split(' ')[0] || contactName,
          lastName: contactName.split(' ').slice(1).join(' ') || '',
          phoneNumber: phone || '0000000000',
          password: hashedPassword,
          role: ['Broker'],
          brokerId: broker._id,
        });

        broker.userId = portalUser._id;
        await broker.save();
      }

      try {
        await loggingService.createLog({
          userId: req.user?._id,
          username: req.user?.username,
          action: 'CREATE',
          entityType: 'BROKER',
          entityId: broker._id,
          changes: { companyName: broker.companyName, brokerCode: broker.brokerCode },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      } catch (_) {
        /* ignore */
      }

      return res.status(201).json({
        success: true,
        data: attachMetrics(broker.toObject(), {}, {}),
      });
    } catch (error) {
      console.error('createBroker error:', error);
      if (error.code === 11000) {
        return res.status(400).json({ success: false, message: 'Duplicate broker code or email' });
      }
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  getBrokers: async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const filter = buildBrokerFilter(req.query);
      const { sortBy, sortDir, mongoSort } = getSort(req.query);

      const [brokers, totalInFilter] = await Promise.all([
        Broker.find(filter).sort(mongoSort).lean(),
        Broker.countDocuments(filter),
      ]);
      const { leadMetrics, orderMetrics } = await loadMetricsForBrokers(brokers);
      let list = brokers.map((b) => attachMetrics(b, leadMetrics, orderMetrics));
      list = sortBrokersWithMetrics(list, sortBy, sortDir);

      const start = (page - 1) * limit;
      const data = list.slice(start, start + limit);

      return res.json({
        success: true,
        data,
        pagination: {
          page,
          limit,
          total: totalInFilter,
          totalPages: Math.ceil(totalInFilter / limit) || 1,
        },
      });
    } catch (error) {
      console.error('getBrokers error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  getBrokerById: async (req, res) => {
    try {
      const broker = await Broker.findById(req.params.id).lean();
      if (!broker) {
        return res.status(404).json({ success: false, message: 'Broker not found' });
      }
      const { leadMetrics, orderMetrics } = await loadMetricsForBrokers([broker]);
      return res.json({ success: true, data: attachMetrics(broker, leadMetrics, orderMetrics) });
    } catch (error) {
      console.error('getBrokerById error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  updateBroker: async (req, res) => {
    try {
      const allowed = [
        'companyName',
        'contactName',
        'email',
        'phone',
        'address',
        'commissionType',
        'commissionValue',
        'notes',
        'status',
      ];
      const updates = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          updates[key] = req.body[key];
        }
      }
      if (updates.email) {
        updates.email = String(updates.email).toLowerCase().trim();
      }
      if (updates.commissionValue != null) {
        updates.commissionValue = Number(updates.commissionValue);
      }

      const broker = await Broker.findByIdAndUpdate(req.params.id, updates, {
        new: true,
        runValidators: true,
      }).lean();

      if (!broker) {
        return res.status(404).json({ success: false, message: 'Broker not found' });
      }

      // Optional: create portal user on update
      if (req.body.createPortalUser && !broker.userId) {
        const portalPassword = req.body.portalPassword;
        if (!portalPassword || String(portalPassword).length < 6) {
          return res.status(400).json({
            success: false,
            message: 'portalPassword must be at least 6 characters',
          });
        }
        const hashedPassword = await bcrypt.hash(portalPassword, 10);
        const portalUser = await BrokerUser.create({
          email: broker.email,
          username: broker.contactName.replace(/\s+/g, '.').toLowerCase(),
          firstName: broker.contactName.split(' ')[0] || broker.contactName,
          lastName: broker.contactName.split(' ').slice(1).join(' ') || '',
          phoneNumber: broker.phone || '0000000000',
          password: hashedPassword,
          role: ['Broker'],
          brokerId: broker._id,
        });
        await Broker.findByIdAndUpdate(broker._id, { userId: portalUser._id });
        broker.userId = portalUser._id;
      }

      const { leadMetrics, orderMetrics } = await loadMetricsForBrokers([broker]);
      return res.json({ success: true, data: attachMetrics(broker, leadMetrics, orderMetrics) });
    } catch (error) {
      console.error('updateBroker error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  deleteBroker: async (req, res) => {
    try {
      const broker = await Broker.findById(req.params.id);
      if (!broker) {
        return res.status(404).json({ success: false, message: 'Broker not found' });
      }

      const brokerId = broker._id;
      const orderIds = (
        await BrokerOrder.find({ brokerId }).select('_id mainTaskId').lean()
      ).map((o) => o._id);

      await Promise.all([
        BrokerLead.deleteMany({ brokerId }),
        BrokerContact.deleteMany({ brokerId }),
        BrokerQuoteRequest.deleteMany({ brokerId }),
        BrokerNegotiation.deleteMany({ brokerId }),
        BrokerOrder.deleteMany({ brokerId }),
        BrokerTask.deleteMany({ brokerId }),
        BrokerDocument.deleteMany({ brokerId }),
        Task.updateMany(
          { $or: [{ brokerId }, { brokerOrderId: { $in: orderIds } }] },
          { $unset: { brokerId: '', brokerOrderId: '' } },
        ),
      ]);

      if (broker.userId) {
        await BrokerUser.findByIdAndDelete(broker.userId);
      }
      await Broker.findByIdAndDelete(brokerId);

      return res.json({ success: true, message: 'Broker deleted' });
    } catch (error) {
      console.error('deleteBroker error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  getOverdueFollowUps: async (req, res) => {
    try {
      const now = new Date();
      const leads = await BrokerLead.find({
        followUpAt: { $lt: now, $ne: null },
        status: { $nin: ['Converted', 'Lost'] },
      })
        .sort({ followUpAt: 1 })
        .lean();

      const brokerIds = [...new Set(leads.map((l) => String(l.brokerId)))];
      const brokers = await Broker.find({ _id: { $in: brokerIds } })
        .select('companyName brokerCode')
        .lean();
      const brokerMap = Object.fromEntries(brokers.map((b) => [String(b._id), b]));

      const data = leads.map((lead) => ({
        ...lead,
        id: lead._id,
        broker: brokerMap[String(lead.brokerId)] || null,
      }));

      return res.json({ success: true, data });
    } catch (error) {
      console.error('getOverdueFollowUps error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  getBrokerStats: async (req, res) => {
    try {
      const [totalBrokers, activeBrokers, leadStats, orderStats, overdueFollowUps] = await Promise.all([
        Broker.countDocuments(),
        Broker.countDocuments({ status: 'Active' }),
        BrokerLead.aggregate([
          {
            $group: {
              _id: null,
              totalProspects: { $sum: 1 },
            },
          },
        ]),
        BrokerOrder.aggregate([
          { $match: { status: { $nin: ['Cancelled', 'Draft'] } } },
          {
            $group: {
              _id: null,
              confirmedOrders: { $sum: 1 },
              totalRevenue: { $sum: { $ifNull: ['$orderAmount', 0] } },
              ordersThisMonth: {
                $sum: {
                  $cond: [
                    {
                      $gte: [
                        '$createdAt',
                        new Date(new Date().getFullYear(), new Date().getMonth(), 1),
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]),
        BrokerLead.countDocuments({
          followUpAt: { $lt: new Date(), $ne: null },
          status: { $nin: ['Converted', 'Lost'] },
        }),
      ]);

      const ls = leadStats[0] || { totalProspects: 0 };
      const os = orderStats[0] || {
        confirmedOrders: 0,
        totalRevenue: 0,
        ordersThisMonth: 0,
      };

      const brokers = await Broker.find().lean();
      const { leadMetrics, orderMetrics } = await loadMetricsForBrokers(brokers);
      const withMetrics = brokers.map((b) => attachMetrics(b, leadMetrics, orderMetrics));
      const activeWithProspects = withMetrics.filter((b) => b.status === 'Active' && b.prospects > 0);
      const avgConvRate =
        activeWithProspects.length > 0
          ? Math.round(
              (activeWithProspects.reduce((s, b) => s + b.conversionRate, 0) /
                activeWithProspects.length) *
                10
            ) / 10
          : 0;

      const now = new Date();
      const yearStart = new Date(now.getFullYear(), 0, 1);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const commissionOrders = await BrokerOrder.find({
        status: { $nin: ['Cancelled', 'Draft'] },
      })
        .select('brokerId commissionAmount commissionStatus commissionPaidAt orderAmount createdAt')
        .lean();

      const brokerLookup = {};
      brokers.forEach((b) => {
        brokerLookup[String(b._id)] = b;
      });

      let totalEarnedYtd = 0;
      let paidThisMonth = 0;
      let pendingPayment = 0;
      let disputed = 0;

      commissionOrders.forEach((order) => {
        const broker = brokerLookup[String(order.brokerId)];
        const amount = resolveCommissionAmount(
          broker,
          order.orderAmount,
          order.commissionAmount,
        );
        if (amount <= 0) return;

        const status = order.commissionStatus || 'Pending';
        const createdAt = order.createdAt ? new Date(order.createdAt) : null;
        const paidAt = order.commissionPaidAt ? new Date(order.commissionPaidAt) : null;

        if (createdAt && createdAt >= yearStart) {
          totalEarnedYtd += amount;
        }

        if (status === 'Paid') {
          if (paidAt && paidAt >= monthStart) {
            paidThisMonth += amount;
          }
        } else if (status === 'Disputed') {
          disputed += amount;
        } else {
          pendingPayment += amount;
        }
      });

      return res.json({
        success: true,
        data: {
          totalBrokers,
          activeBrokers,
          totalProspects: ls.totalProspects,
          confirmedOrders: os.confirmedOrders,
          ordersThisMonth: os.ordersThisMonth,
          avgConversionRate: avgConvRate,
          totalRevenue: os.totalRevenue,
          commissionDue: pendingPayment + disputed,
          totalEarnedYtd,
          paidThisMonth,
          pendingPayment,
          disputed,
          overdueFollowUps,
        },
      });
    } catch (error) {
      console.error('getBrokerStats error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  getBrokerDetailStats: async (req, res) => {
    try {
      const brokerId = req.params.id;
      const broker = await Broker.findById(brokerId).lean();
      if (!broker) {
        return res.status(404).json({ success: false, message: 'Broker not found' });
      }

      const leads = await BrokerLead.find({ brokerId }).lean();
      const orders = await BrokerOrder.find({
        brokerId,
        status: { $nin: ['Cancelled', 'Draft'] },
      }).lean();

      const totalProspects = leads.length;
      const contacted = leads.filter((l) =>
        ['Contacted', 'QuotationSent', 'Negotiation', 'Converted'].includes(l.status)
      ).length;
      const quotationsSent = leads.filter((l) =>
        ['QuotationSent', 'Negotiation', 'Converted'].includes(l.status)
      ).length;
      const activeQuotations = leads.filter((l) =>
        ['QuotationSent', 'Negotiation'].includes(l.status)
      ).length;
      const convertedLeads = leads.filter((l) => l.status === 'Converted').length;
      const lostLeads = leads.filter((l) => l.status === 'Lost').length;
      const confirmedOrders = orders.length;
      const conversionRate =
        totalProspects > 0 ? Math.round((convertedLeads / totalProspects) * 1000) / 10 : 0;
      const totalRevenue = orders.reduce((s, o) => s + (Number(o.orderAmount) || 0), 0);
      const commissionEarned = orders.reduce(
        (s, o) => s + resolveCommissionAmount(broker, o.orderAmount, o.commissionAmount),
        0,
      );
      const avgOrderValue =
        confirmedOrders > 0 ? Math.round(totalRevenue / confirmedOrders) : 0;

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const yearStart = new Date(now.getFullYear(), 0, 1);
      const ordersThisMonth = orders.filter(
        (o) => new Date(o.createdAt) >= monthStart,
      ).length;
      const ordersThisYear = orders.filter(
        (o) => new Date(o.createdAt) >= yearStart,
      ).length;

      const statusDist = {};
      for (const l of leads) {
        statusDist[l.status] = (statusDist[l.status] || 0) + 1;
      }

      const leadMetrics = {
        [String(broker._id)]: {
          prospects: totalProspects,
          orders: convertedLeads,
          revenue: totalRevenue,
          pipelineValue: leads.reduce((s, l) => s + (l.pipelineValue || 0), 0),
          conversionRate,
        },
      };
      const orderMetrics = {
        [String(broker._id)]: {
          orders: confirmedOrders,
          revenue: totalRevenue,
          commissionEarned,
        },
      };

      return res.json({
        success: true,
        data: {
          broker: attachMetrics(broker, leadMetrics, orderMetrics),
          kpis: {
            totalProspects,
            contacted,
            quotationsSent,
            activeQuotations,
            confirmedOrders,
            lostLeads,
            conversionRate,
            totalRevenue,
            avgOrderValue,
            commissionEarned,
            ordersThisMonth,
            ordersThisYear,
          },
          statusDistribution: statusDist,
        },
      });
    } catch (error) {
      console.error('getBrokerDetailStats error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },
};

module.exports = brokerCtrl;
