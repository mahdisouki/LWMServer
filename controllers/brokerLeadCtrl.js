const Broker = require('../models/Broker');
const BrokerLead = require('../models/BrokerLead');
const BrokerTask = require('../models/BrokerTask');
const BrokerContact = require('../models/BrokerContact');
const BrokerQuoteRequest = require('../models/BrokerQuoteRequest');
const BrokerNegotiation = require('../models/BrokerNegotiation');
const BrokerOrder = require('../models/BrokerOrder');
const BrokerDocument = require('../models/BrokerDocument');
const { LEAD_STATUSES } = require('../models/BrokerLead');
const { resolveBrokerIdForUser } = require('../utils/brokerScope');
const { escapeRegex, pushActivity } = require('../utils/brokerHelpers');

const LEAD_EXTRA_FIELDS = [
  'customerType',
  'firstName',
  'lastName',
  'jobTitle',
  'preferredLanguage',
  'preferredCommunication',
  'customerCategory',
  'existingCustomer',
  'secondaryEmail',
  'secondaryPhone',
  'mobile',
  'whatsapp',
  'preferredContactTime',
  'addressLine1',
  'addressLine2',
  'city',
  'postalCode',
  'region',
  'country',
  'industry',
  'billingAddress',
  'preferredCollectionDate',
  'preferredCollectionTime',
  'leadTitle',
  'description',
  'customerNeed',
  'productSubtype',
  'estimatedQuantity',
  'expectedDecisionDate',
  'expectedDeliveryDate',
  'leadSource',
  'campaign',
  'tags',
  'internalComments',
  'assignedBroker',
  'team',
  'territory',
  'reminder',
];

const LEAD_DATE_FIELDS = [
  'followUpAt',
  'expectedDecisionDate',
  'expectedDeliveryDate',
  'preferredCollectionDate',
];

/** Parse a calendar date safely. Empty/invalid → null (never "today"). */
function parseLeadDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      return new Date(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T12:00:00.000Z`);
    }
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function pickLeadExtras(body) {
  const extras = {};
  for (const key of LEAD_EXTRA_FIELDS) {
    if (body[key] !== undefined) {
      if (LEAD_DATE_FIELDS.includes(key)) {
        extras[key] = parseLeadDate(body[key]);
      } else {
        extras[key] = body[key];
      }
    }
  }
  return extras;
}

function normalizeCommunicationLogs(logs = []) {
  if (!Array.isArray(logs)) return [];
  return logs
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      action: String(item.action || '').trim() || 'Internal Note',
      detail: String(item.detail || '').trim(),
      actorName: String(item.actorName || '').trim(),
      createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 100);
}

const brokerLeadCtrl = {
  // Admin: list leads for a broker
  getLeadsByBroker: async (req, res) => {
    try {
      const brokerId = req.params.brokerId || req.params.id;
      if (!brokerId) {
        return res.status(400).json({ success: false, message: 'brokerId is required' });
      }
      const filter = { brokerId };
      if (req.query.status && req.query.status !== 'all') {
        filter.status = req.query.status;
      }
      if (req.query.priority && req.query.priority !== 'all') {
        filter.priority = req.query.priority;
      }
      if (req.query.keyword) {
        const regex = new RegExp(escapeRegex(req.query.keyword), 'i');
        filter.$or = [{ companyName: regex }, { contactName: regex }, { email: regex }];
      }

      const leads = await BrokerLead.find(filter).sort({ updatedAt: -1 }).lean();
      return res.json({
        success: true,
        data: leads.map((l) => ({
          ...l,
          id: l._id,
          referenceCode: `LD-${new Date(l.createdAt || Date.now()).getFullYear()}-${String(l._id).slice(-4).toUpperCase()}`,
          lastActivityAt: l.activityLog?.[0]?.createdAt || l.updatedAt,
        })),
      });
    } catch (error) {
      console.error('getLeadsByBroker error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  // Admin or shared create
  createLead: async (req, res) => {
    try {
      const brokerId = req.params.brokerId || req.body.brokerId;
      if (!brokerId) {
        return res.status(400).json({ success: false, message: 'brokerId is required' });
      }

      const broker = await Broker.findById(brokerId);
      if (!broker) {
        return res.status(404).json({ success: false, message: 'Broker not found' });
      }

      const body = req.body;
      const {
        companyName,
        contactName,
        phone,
        email,
        status,
        priority,
        wasteType,
        frequency,
        followUpAt,
        pipelineValue,
        notes,
      } = body;

      if (!companyName || !contactName) {
        return res.status(400).json({
          success: false,
          message: 'companyName and contactName are required',
        });
      }

      const lead = new BrokerLead({
        brokerId,
        companyName,
        contactName,
        phone: phone || body.mobile || '',
        email: email || '',
        status: status && LEAD_STATUSES.includes(status) ? status : 'NewLead',
        priority: priority || 'Medium',
        wasteType: wasteType || body.leadTitle || '',
        frequency: frequency || body.estimatedQuantity || '',
        followUpAt: parseLeadDate(followUpAt),
        pipelineValue: pipelineValue != null ? Number(pipelineValue) : 0,
        notes: notes || body.internalComments || '',
        ...pickLeadExtras(body),
        activityLog: [
          {
            action: 'Lead created',
            detail: companyName,
            actorName: req.user?.username || req.user?.firstName || 'Admin',
            createdAt: new Date(),
          },
        ],
        communicationLogs: [],
      });

      await lead.save();
      return res.status(201).json({ success: true, data: { ...lead.toObject(), id: lead._id } });
    } catch (error) {
      console.error('createLead error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  updateLead: async (req, res) => {
    try {
      const lead = await BrokerLead.findById(req.params.leadId);
      if (!lead) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }

      const allowed = [
        'companyName',
        'contactName',
        'phone',
        'email',
        'status',
        'priority',
        'wasteType',
        'frequency',
        'followUpAt',
        'pipelineValue',
        'notes',
        ...LEAD_EXTRA_FIELDS,
      ];
      const changes = [];
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          if (key === 'status' && !LEAD_STATUSES.includes(req.body[key])) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
          }
          if (key === 'followUpAt' || LEAD_DATE_FIELDS.includes(key)) {
            lead[key] = parseLeadDate(req.body[key]);
          } else if (key === 'pipelineValue') {
            lead[key] = Number(req.body[key]);
          } else {
            if (String(lead[key]) !== String(req.body[key])) {
              changes.push(key);
            }
            lead[key] = req.body[key];
          }
        }
      }

      if (req.body.communicationLogs !== undefined) {
        lead.communicationLogs = normalizeCommunicationLogs(req.body.communicationLogs);
      }

      if (changes.length) {
        pushActivity(
          lead,
          'Lead updated',
          `Updated: ${changes.join(', ')}`,
          req.user?.username || req.user?.firstName || 'User'
        );
      }

      await lead.save();
      return res.json({ success: true, data: { ...lead.toObject(), id: lead._id } });
    } catch (error) {
      console.error('updateLead error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  deleteLead: async (req, res) => {
    try {
      const lead = await BrokerLead.findByIdAndDelete(req.params.leadId);
      if (!lead) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }
      return res.json({ success: true, message: 'Lead deleted' });
    } catch (error) {
      console.error('deleteLead error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  // Portal: my leads
  getMyLeads: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }

      const filter = { brokerId };
      if (req.query.status && req.query.status !== 'all') {
        filter.status = req.query.status;
      }
      if (req.query.priority && req.query.priority !== 'all') {
        filter.priority = req.query.priority;
      }
      if (req.query.keyword) {
        const regex = new RegExp(escapeRegex(req.query.keyword), 'i');
        filter.$or = [{ companyName: regex }, { contactName: regex }, { email: regex }];
      }

      const leads = await BrokerLead.find(filter).sort({ updatedAt: -1 }).lean();
      return res.json({
        success: true,
        data: leads.map((l) => ({
          ...l,
          id: l._id,
          referenceCode: `LD-${new Date(l.createdAt || Date.now()).getFullYear()}-${String(l._id).slice(-4).toUpperCase()}`,
          lastActivityAt: l.activityLog?.[0]?.createdAt || l.updatedAt,
        })),
      });
    } catch (error) {
      console.error('getMyLeads error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  createMyLead: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }
      req.params.brokerId = String(brokerId);
      return brokerLeadCtrl.createLead(req, res);
    } catch (error) {
      console.error('createMyLead error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  updateMyLead: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }
      const lead = await BrokerLead.findById(req.params.leadId);
      if (!lead || String(lead.brokerId) !== String(brokerId)) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }
      return brokerLeadCtrl.updateLead(req, res);
    } catch (error) {
      console.error('updateMyLead error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  getMyLeadById: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }

      const lead = await BrokerLead.findOne({ _id: req.params.leadId, brokerId }).lean();
      if (!lead) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }

      const leadId = lead._id;
      const [contacts, quotes, negotiations, orders, tasks, documents] = await Promise.all([
        BrokerContact.find({ brokerId, leadId }).sort({ updatedAt: -1 }).lean(),
        BrokerQuoteRequest.find({ brokerId, leadId }).sort({ updatedAt: -1 }).lean(),
        BrokerNegotiation.find({ brokerId, leadId }).sort({ updatedAt: -1 }).lean(),
        BrokerOrder.find({ brokerId, leadId }).sort({ updatedAt: -1 }).lean(),
        BrokerTask.find({ brokerId, leadId }).sort({ updatedAt: -1 }).lean(),
        BrokerDocument.find({ brokerId, leadId }).sort({ updatedAt: -1 }).lean(),
      ]);

      const latestQuote = quotes[0] || null;
      const latestNegotiation = negotiations[0] || null;
      const latestOrder = orders[0] || null;

      return res.json({
        success: true,
        data: {
          ...lead,
          id: lead._id,
          referenceCode: `LD-${new Date(lead.createdAt || Date.now()).getFullYear()}-${String(lead._id).slice(-4).toUpperCase()}`,
          counts: {
            contacts: contacts.length,
            quotes: quotes.length,
            negotiations: negotiations.length,
            orders: orders.length,
            tasks: tasks.length,
            documents: documents.length,
          },
          related: {
            contacts,
            quotes,
            negotiations,
            orders,
            tasks,
            documents,
          },
          commercial: {
            estimatedBudget: lead.pipelineValue || 0,
            proposedPrice: latestQuote?.quotedAmount ?? latestQuote?.estimatedValue ?? lead.pipelineValue ?? 0,
            agreedPrice: latestNegotiation?.agreedAmount ?? latestOrder?.orderAmount ?? null,
          },
        },
      });
    } catch (error) {
      console.error('getMyLeadById error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  getMyDashboard: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }

      const broker = await Broker.findById(brokerId).lean();
      const leads = await BrokerLead.find({ brokerId }).sort({ updatedAt: -1 }).lean();

      const byStatus = {};
      for (const s of LEAD_STATUSES) byStatus[s] = { count: 0, value: 0 };
      for (const l of leads) {
        if (!byStatus[l.status]) byStatus[l.status] = { count: 0, value: 0 };
        byStatus[l.status].count += 1;
        byStatus[l.status].value += l.pipelineValue || 0;
      }

      const activeStatuses = LEAD_STATUSES.filter((s) => !['Converted', 'Lost'].includes(s));
      const activeLeads = leads.filter((l) => activeStatuses.includes(l.status)).length;
      const converted = byStatus.Converted?.count || 0;
      const conversionRate =
        leads.length > 0 ? Math.round((converted / leads.length) * 1000) / 10 : 0;
      const pipelineValue = leads
        .filter((l) => activeStatuses.includes(l.status))
        .reduce((s, l) => s + (l.pipelineValue || 0), 0);

      const now = new Date();
      const leadFollowUps = leads
        .filter((l) => l.followUpAt && !['Converted', 'Lost'].includes(l.status))
        .map((l) => ({
          id: l._id,
          title: `Follow up — ${l.companyName}`,
          companyName: l.companyName,
          priority: l.priority,
          followUpAt: l.followUpAt,
          overdue: new Date(l.followUpAt) < now,
          status: l.status,
          sourceType: 'lead',
        }));

      const openTasks = await BrokerTask.find({
        brokerId,
        dueAt: { $ne: null },
        status: { $in: ['Pending', 'InProgress'] },
      })
        .sort({ dueAt: 1 })
        .limit(20)
        .lean();

      const taskFollowUps = openTasks.map((t) => ({
        id: t._id,
        title: t.title,
        companyName: t.companyName,
        priority: t.priority,
        followUpAt: t.dueAt,
        overdue: new Date(t.dueAt) < now,
        status: t.status,
        sourceType: 'task',
        referenceCode: t.referenceCode,
      }));

      const followUps = [...taskFollowUps, ...leadFollowUps]
        .sort((a, b) => new Date(a.followUpAt) - new Date(b.followUpAt))
        .slice(0, 20);

      const recentActivity = [];
      for (const l of leads) {
        for (const a of l.activityLog || []) {
          recentActivity.push({
            leadId: l._id,
            leadCode: `LD-${String(l._id).slice(-6).toUpperCase()}`,
            companyName: l.companyName,
            status: l.status,
            action: a.action,
            detail: a.detail,
            actorName: a.actorName,
            createdAt: a.createdAt,
          });
        }
      }
      recentActivity.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return res.json({
        success: true,
        data: {
          broker,
          greetingName: broker?.contactName?.split(' ')[0] || req.user?.firstName || 'Broker',
          summary: {
            activeLeads,
            draftLeads: byStatus.Draft?.count || 0,
            validated: byStatus.NewLead?.count || 0,
            quotesInProgress: byStatus.QuotationSent?.count || 0,
            negotiations: byStatus.Negotiation?.count || 0,
            ordersCreated: converted,
            conversionRate,
            pipelineValue,
          },
          pipeline: Object.entries(byStatus).map(([status, v]) => ({
            status,
            count: v.count,
            value: v.value,
            percent: leads.length ? Math.round((v.count / leads.length) * 100) : 0,
          })),
          followUps,
          recentActivity: recentActivity.slice(0, 20),
        },
      });
    } catch (error) {
      console.error('getMyDashboard error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },
};

module.exports = brokerLeadCtrl;
