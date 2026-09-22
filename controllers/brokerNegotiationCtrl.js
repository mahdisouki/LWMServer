const BrokerNegotiation = require('../models/BrokerNegotiation');
const BrokerQuoteRequest = require('../models/BrokerQuoteRequest');
const BrokerLead = require('../models/BrokerLead');
const { NEGOTIATION_STATUSES } = require('../models/BrokerNegotiation');
const { resolveBrokerIdForUser } = require('../utils/brokerScope');

const { escapeRegex, pushActivity, nextReferenceCode } = require('../utils/brokerHelpers');

function buildFilter(brokerId, query = {}) {
  const filter = { brokerId };
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.leadId) filter.leadId = query.leadId;
  if (query.quoteRequestId) filter.quoteRequestId = query.quoteRequestId;
  if (query.keyword && String(query.keyword).trim()) {
    const regex = new RegExp(escapeRegex(String(query.keyword).trim()), 'i');
    filter.$or = [{ companyName: regex }, { referenceCode: regex }];
  }
  return filter;
}

async function syncLeadStatus(lead, negotiationStatus) {
  if (!lead) return;
  if (negotiationStatus === 'Agreed' || negotiationStatus === 'InProgress' || negotiationStatus === 'AwaitingCustomer') {
    lead.status = 'Negotiation';
  } else if (negotiationStatus === 'Declined') {
    lead.status = 'Lost';
  } else if (negotiationStatus === 'Open') {
    lead.status = 'Negotiation';
  }
  await lead.save();
}

const brokerNegotiationCtrl = {
  listByBroker: async (req, res) => {
    try {
      const brokerId = req.params.brokerId || req.params.id;
      if (!brokerId) {
        return res.status(400).json({ success: false, message: 'brokerId is required' });
      }
      const items = await BrokerNegotiation.find(buildFilter(brokerId, req.query))
        .sort({ updatedAt: -1 })
        .lean();
      return res.json({
        success: true,
        data: items.map((n) => ({ ...n, id: n._id })),
      });
    } catch (error) {
      console.error('listByBroker negotiations error:', error);
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
        quoteRequestId,
        companyName,
        quotedAmount,
        customerOffer,
        counterOffer,
        agreedAmount,
        priority,
        followUpAt,
        notes,
        status,
      } = req.body;

      if (!leadId) {
        return res.status(400).json({ success: false, message: 'leadId is required' });
      }

      const lead = await BrokerLead.findOne({ _id: leadId, brokerId });
      if (!lead) {
        return res.status(404).json({ success: false, message: 'Lead not found for this broker' });
      }

      let quote = null;
      if (quoteRequestId) {
        quote = await BrokerQuoteRequest.findOne({ _id: quoteRequestId, brokerId });
        if (!quote) {
          return res.status(404).json({ success: false, message: 'Quote request not found' });
        }
        if (!['Quoted', 'InReview', 'Submitted'].includes(quote.status)) {
          return res.status(400).json({
            success: false,
            message: 'Quote request must be submitted or quoted before starting negotiation',
          });
        }
      }

      const actorName = req.user?.username || req.user?.firstName || 'User';
      const referenceCode = await nextReferenceCode(BrokerNegotiation, 'NEG');
      const initialStatus = status && NEGOTIATION_STATUSES.includes(status) ? status : 'Open';

      const negotiation = await BrokerNegotiation.create({
        brokerId,
        leadId,
        quoteRequestId: quoteRequestId || null,
        referenceCode,
        companyName: companyName || lead.companyName,
        status: initialStatus,
        priority: priority || 'Medium',
        quotedAmount:
          quotedAmount != null
            ? Number(quotedAmount)
            : quote?.quotedAmount || quote?.estimatedValue || lead.pipelineValue || 0,
        customerOffer: customerOffer != null ? Number(customerOffer) : null,
        counterOffer: counterOffer != null ? Number(counterOffer) : null,
        agreedAmount: agreedAmount != null ? Number(agreedAmount) : null,
        followUpAt: followUpAt ? new Date(followUpAt) : null,
        notes: notes || '',
        activityLog: [
          {
            action: 'Negotiation opened',
            detail: referenceCode,
            actorName,
            createdAt: new Date(),
          },
        ],
      });

      lead.status = 'Negotiation';
      if (!lead.activityLog) lead.activityLog = [];
      lead.activityLog.unshift({
        action: 'Negotiation started',
        detail: referenceCode,
        actorName,
        createdAt: new Date(),
      });
      await lead.save();

      if (quote && quote.status !== 'Quoted') {
        quote.status = 'Quoted';
        pushActivity(quote, 'Moved to negotiation', referenceCode, actorName);
        await quote.save();
      }

      return res.status(201).json({
        success: true,
        data: { ...negotiation.toObject(), id: negotiation._id },
      });
    } catch (error) {
      console.error('create negotiation error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  update: async (req, res) => {
    try {
      const negotiation = await BrokerNegotiation.findById(req.params.negotiationId);
      if (!negotiation) {
        return res.status(404).json({ success: false, message: 'Negotiation not found' });
      }

      const allowed = [
        'status',
        'priority',
        'quotedAmount',
        'customerOffer',
        'counterOffer',
        'agreedAmount',
        'followUpAt',
        'notes',
      ];
      const actorName = req.user?.username || req.user?.firstName || 'User';
      const changes = [];

      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          if (key === 'status' && !NEGOTIATION_STATUSES.includes(req.body[key])) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
          }
          if (key === 'followUpAt') {
            negotiation[key] = req.body[key] ? new Date(req.body[key]) : null;
          } else if (['quotedAmount', 'customerOffer', 'counterOffer', 'agreedAmount'].includes(key)) {
            negotiation[key] = req.body[key] != null ? Number(req.body[key]) : null;
          } else {
            negotiation[key] = req.body[key];
          }
          changes.push(key);
        }
      }

      // Free-text progress note from the broker portal, kept as its own trail
      // entry so the discussion history survives later field updates.
      const updateNote = String(req.body.updateNote || '').trim();
      if (updateNote) {
        pushActivity(negotiation, 'Negotiation update', updateNote, actorName);
      }

      if (changes.length) {
        pushActivity(negotiation, 'Negotiation updated', changes.join(', '), actorName);
      }

      await negotiation.save();

      const lead = await BrokerLead.findById(negotiation.leadId);
      if (lead && negotiation.status) {
        await syncLeadStatus(lead, negotiation.status);
      }

      if (negotiation.status === 'Agreed' && negotiation.agreedAmount != null) {
        if (lead) {
          lead.pipelineValue = negotiation.agreedAmount;
          await lead.save();
        }
      }

      return res.json({ success: true, data: { ...negotiation.toObject(), id: negotiation._id } });
    } catch (error) {
      console.error('update negotiation error:', error);
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
      return brokerNegotiationCtrl.listByBroker(req, res);
    } catch (error) {
      console.error('listMine negotiations error:', error);
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
      return brokerNegotiationCtrl.create(req, res);
    } catch (error) {
      console.error('createMine negotiation error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  updateMine: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }
      const negotiation = await BrokerNegotiation.findById(req.params.negotiationId);
      if (!negotiation || String(negotiation.brokerId) !== String(brokerId)) {
        return res.status(404).json({ success: false, message: 'Negotiation not found' });
      }
      return brokerNegotiationCtrl.update(req, res);
    } catch (error) {
      console.error('updateMine negotiation error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },
};

module.exports = brokerNegotiationCtrl;
