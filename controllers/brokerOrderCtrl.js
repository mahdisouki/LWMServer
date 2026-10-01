const BrokerOrder = require('../models/BrokerOrder');
const Broker = require('../models/Broker');
const BrokerNegotiation = require('../models/BrokerNegotiation');
const BrokerLead = require('../models/BrokerLead');
const BrokerQuoteRequest = require('../models/BrokerQuoteRequest');
const { ORDER_STATUSES, COMMISSION_STATUSES } = require('../models/BrokerOrder');
const { resolveBrokerIdForUser } = require('../utils/brokerScope');
const { notifyBrokerOrg } = require('../utils/brokerNotifications');
const {
  syncBrokerOrderToMainSystem,
  loadBrokerSyncContext,
  handleBrokerOrderMainSystemVisibility,
  isOrderVisibleInMainSystem,
  notifyAdmins,
} = require('../services/brokerMainSystemSyncService');

const { escapeRegex, pushActivity, nextReferenceCode } = require('../utils/brokerHelpers');
const { resolveCommissionAmount } = require('../utils/brokerCommission');

function buildFilter(brokerId, query = {}) {
  const filter = { brokerId };
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.leadId) filter.leadId = query.leadId;
  if (query.negotiationId) filter.negotiationId = query.negotiationId;
  if (query.keyword && String(query.keyword).trim()) {
    const regex = new RegExp(escapeRegex(String(query.keyword).trim()), 'i');
    filter.$or = [{ companyName: regex }, { referenceCode: regex }];
  }
  return filter;
}

async function syncLeadFromOrder(lead, order) {
  if (!lead) return;
  const convertedStatuses = ['Confirmed', 'InProgress', 'Completed'];
  if (convertedStatuses.includes(order.status)) {
    lead.status = 'Converted';
    if (order.orderAmount != null) {
      lead.pipelineValue = Number(order.orderAmount) || 0;
    }
  } else if (order.status === 'Cancelled') {
    lead.status = 'Lost';
  }
  await lead.save();
}

const brokerOrderCtrl = {
  listByBroker: async (req, res) => {
    try {
      const brokerId = req.params.brokerId || req.params.id;
      if (!brokerId) {
        return res.status(400).json({ success: false, message: 'brokerId is required' });
      }
      const broker = await Broker.findById(brokerId)
        .select('commissionType commissionValue')
        .lean();
      const items = await BrokerOrder.find(buildFilter(brokerId, req.query))
        .sort({ updatedAt: -1 })
        .lean();
      return res.json({
        success: true,
        data: items.map((o) => {
          const commissionAmount = resolveCommissionAmount(
            broker,
            o.orderAmount,
            o.commissionAmount,
          );
          return { ...o, commissionAmount, id: o._id };
        }),
      });
    } catch (error) {
      console.error('listByBroker orders error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  create: async (req, res) => {
    try {
      const brokerId = req.params.brokerId || req.params.id || req.body.brokerId;
      if (!brokerId) {
        return res.status(400).json({ success: false, message: 'brokerId is required' });
      }

      const {
        leadId,
        negotiationId,
        quoteRequestId,
        companyName,
        orderAmount,
        commissionAmount,
        wasteType,
        frequency,
        siteAddress,
        priority,
        scheduledAt,
        notes,
        status,
      } = req.body;

      if (!leadId && !negotiationId && !quoteRequestId) {
        return res.status(400).json({
          success: false,
          message: 'leadId, quoteRequestId, or negotiationId is required',
        });
      }

      let negotiation = null;
      let quote = null;

      if (quoteRequestId && !negotiationId) {
        quote = await BrokerQuoteRequest.findOne({ _id: quoteRequestId, brokerId });
        if (!quote) {
          return res.status(404).json({ success: false, message: 'Quote request not found' });
        }
        if (['Draft', 'Rejected', 'Cancelled'].includes(quote.status)) {
          return res.status(400).json({
            success: false,
            message: 'Quote must be submitted before converting to an order',
          });
        }
        const existingOrder = await BrokerOrder.findOne({
          brokerId,
          quoteRequestId,
          status: { $nin: ['Cancelled'] },
        });
        if (existingOrder) {
          return res.status(400).json({
            success: false,
            message: 'An order already exists for this quote',
          });
        }
      }

      if (negotiationId) {
        negotiation = await BrokerNegotiation.findOne({ _id: negotiationId, brokerId });
        if (!negotiation) {
          return res.status(404).json({ success: false, message: 'Negotiation not found' });
        }
        if (negotiation.status !== 'Agreed') {
          return res.status(400).json({
            success: false,
            message: 'Negotiation must be Agreed before creating an order',
          });
        }
      }

      const resolvedLeadId = leadId || negotiation?.leadId || quote?.leadId;
      const lead = await BrokerLead.findOne({ _id: resolvedLeadId, brokerId });
      if (!lead) {
        return res.status(404).json({ success: false, message: 'Lead not found for this broker' });
      }

      const actorName = req.user?.username || req.user?.firstName || 'User';
      const referenceCode = await nextReferenceCode(BrokerOrder, 'ORD');
      const initialStatus =
        status && ORDER_STATUSES.includes(status) ? status : 'Confirmed';
      const resolvedQuoteRequestId = quoteRequestId || negotiation?.quoteRequestId || quote?._id || null;
      const broker = await Broker.findById(brokerId).select('commissionType commissionValue companyName');
      const resolvedOrderAmount =
        orderAmount != null
          ? Number(orderAmount)
          : negotiation?.agreedAmount ||
            negotiation?.quotedAmount ||
            quote?.quotedAmount ||
            quote?.estimatedValue ||
            lead.pipelineValue ||
            0;

      const order = await BrokerOrder.create({
        brokerId,
        leadId: resolvedLeadId,
        negotiationId: negotiationId || null,
        quoteRequestId: resolvedQuoteRequestId,
        referenceCode,
        companyName: companyName || negotiation?.companyName || quote?.companyName || lead.companyName,
        status: initialStatus,
        priority: priority || negotiation?.priority || 'Medium',
        orderAmount: resolvedOrderAmount,
        commissionAmount: resolveCommissionAmount(broker, resolvedOrderAmount, commissionAmount),
        wasteType: wasteType || quote?.wasteType || lead.wasteType || '',
        frequency: frequency || quote?.frequency || lead.frequency || '',
        siteAddress: siteAddress || quote?.siteAddress || '',
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        notes: notes || '',
        activityLog: [
          {
            action: 'Order created',
            detail: referenceCode,
            actorName,
            createdAt: new Date(),
          },
        ],
      });

      if (!lead.activityLog) lead.activityLog = [];
      lead.activityLog.unshift({
        action: 'Order created',
        detail: referenceCode,
        actorName,
        createdAt: new Date(),
      });
      await syncLeadFromOrder(lead, order);

      if (negotiation) {
        negotiation.status = 'Closed';
        pushActivity(negotiation, 'Order created', referenceCode, actorName);
        await negotiation.save();
      }

      const companyLabel = order.companyName || lead.companyName;
      await notifyBrokerOrg(brokerId, {
        type: 'Orders',
        message: `Order ${referenceCode} created for ${companyLabel}`,
        senderName: actorName,
        metadata: {
          type: 'Orders',
          brokerId: String(brokerId),
          leadId: String(resolvedLeadId),
          quoteRequestId: resolvedQuoteRequestId ? String(resolvedQuoteRequestId) : null,
          orderId: String(order._id),
        },
        emailSubject: `New order: ${referenceCode}`,
        emailHtml: `<p>Hello,</p><p>Order <strong>${referenceCode}</strong> was created for <strong>${companyLabel}</strong>.</p><p>Created by: ${actorName}</p>`,
      }, req.user?._id || req.user?.id);

      try {
        const ctx = await loadBrokerSyncContext(brokerId, resolvedLeadId);
        if (ctx && isOrderVisibleInMainSystem(initialStatus)) {
          await syncBrokerOrderToMainSystem({
            order,
            lead: ctx.lead,
            broker: ctx.broker,
            actorName,
          });
        } else if (req.broker) {
          // A broker handing work over raises a Draft order, which never reaches
          // the main system, so nothing else would tell the back office about it.
          await notifyAdmins({
            type: 'Orders',
            message: `Broker order ${referenceCode} from ${broker?.companyName || 'a broker'} is awaiting confirmation for ${companyLabel}`,
            senderName: actorName,
            metadata: {
              type: 'Orders',
              brokerId: String(brokerId),
              leadId: String(resolvedLeadId),
              orderId: String(order._id),
              orderStatus: order.status,
            },
          });
        }
      } catch (syncError) {
        console.error('syncBrokerOrderToMainSystem error:', syncError);
      }

      return res.status(201).json({
        success: true,
        data: { ...order.toObject(), id: order._id },
      });
    } catch (error) {
      console.error('create order error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  update: async (req, res) => {
    try {
      const order = await BrokerOrder.findById(req.params.orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }

      const allowed = [
        'status',
        'priority',
        'orderAmount',
        'commissionAmount',
        'commissionStatus',
        'commissionDisputeNote',
        'wasteType',
        'frequency',
        'siteAddress',
        'scheduledAt',
        'notes',
        'companyName',
      ];
      const actorName = req.user?.username || req.user?.firstName || 'User';
      const changes = [];
      const previousStatus = order.status;

      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          if (key === 'status' && !ORDER_STATUSES.includes(req.body[key])) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
          }
          if (key === 'commissionStatus') {
            if (!COMMISSION_STATUSES.includes(req.body[key])) {
              return res.status(400).json({ success: false, message: 'Invalid commission status' });
            }
            order.commissionStatus = req.body[key];
            if (req.body[key] === 'Paid') {
              order.commissionPaidAt = new Date();
            } else {
              order.commissionPaidAt = null;
            }
            if (req.body[key] !== 'Disputed') {
              order.commissionDisputeNote = '';
            }
            changes.push(`commission:${req.body[key]}`);
            continue;
          }
          if (key === 'scheduledAt') {
            order[key] = req.body[key] ? new Date(req.body[key]) : null;
          } else if (['orderAmount', 'commissionAmount'].includes(key)) {
            order[key] = req.body[key] != null ? Number(req.body[key]) : null;
          } else {
            order[key] = req.body[key];
          }
          changes.push(key);
        }
      }

      if (changes.length) {
        pushActivity(order, 'Order updated', changes.join(', '), actorName);
      }

      if (req.body.orderAmount !== undefined && req.body.commissionAmount === undefined) {
        const broker = await Broker.findById(order.brokerId).select('commissionType commissionValue');
        order.commissionAmount = resolveCommissionAmount(broker, order.orderAmount, null);
      }

      await order.save();

      const lead = await BrokerLead.findById(order.leadId);
      if (lead) {
        await syncLeadFromOrder(lead, order);
      }

      if (req.body.status !== undefined && req.body.status !== previousStatus) {
        try {
          const ctx = await loadBrokerSyncContext(order.brokerId, order.leadId);
          if (ctx) {
            await handleBrokerOrderMainSystemVisibility({
              order,
              previousStatus,
              lead: ctx.lead,
              broker: ctx.broker,
              actorName,
            });
          }
        } catch (syncError) {
          console.error('handleBrokerOrderMainSystemVisibility error:', syncError);
        }
      }

      return res.json({ success: true, data: { ...order.toObject(), id: order._id } });
    } catch (error) {
      console.error('update order error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  listMine: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }
      req.params.id = String(brokerId);
      return brokerOrderCtrl.listByBroker(req, res);
    } catch (error) {
      console.error('listMine orders error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  createMine: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }
      req.params.brokerId = String(brokerId);
      return brokerOrderCtrl.create(req, res);
    } catch (error) {
      console.error('createMine order error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  updateMine: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }
      const order = await BrokerOrder.findById(req.params.orderId);
      if (!order || String(order.brokerId) !== String(brokerId)) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }
      return brokerOrderCtrl.update(req, res);
    } catch (error) {
      console.error('updateMine order error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },
};

module.exports = brokerOrderCtrl;
