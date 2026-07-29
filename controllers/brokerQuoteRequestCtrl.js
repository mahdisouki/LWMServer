const BrokerQuoteRequest = require('../models/BrokerQuoteRequest');
const BrokerLead = require('../models/BrokerLead');
const BrokerContact = require('../models/BrokerContact');
const { QUOTE_REQUEST_STATUSES } = require('../models/BrokerQuoteRequest');
const { resolveBrokerIdForUser } = require('../utils/brokerScope');
const { notifyBrokerOrg } = require('../utils/brokerNotifications');
const {
  syncBrokerQuoteToMainSystem,
  syncBrokerOrderToMainSystem,
  loadBrokerSyncContext,
} = require('../services/brokerMainSystemSyncService');

const { escapeRegex, pushActivity, nextReferenceCode } = require('../utils/brokerHelpers');

function buildQuoteFilter(brokerId, query = {}) {
  const filter = { brokerId };
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.leadId) filter.leadId = query.leadId;
  if (query.keyword && String(query.keyword).trim()) {
    const regex = new RegExp(escapeRegex(String(query.keyword).trim()), 'i');
    filter.$or = [{ companyName: regex }, { referenceCode: regex }, { siteAddress: regex }];
  }
  return filter;
}

const brokerQuoteRequestCtrl = {
  listByBroker: async (req, res) => {
    try {
      const brokerId = req.params.brokerId || req.params.id;
      if (!brokerId) {
        return res.status(400).json({ success: false, message: 'brokerId is required' });
      }
      const quotes = await BrokerQuoteRequest.find(buildQuoteFilter(brokerId, req.query))
        .sort({ updatedAt: -1 })
        .lean();
      return res.json({
        success: true,
        data: quotes.map((q) => ({ ...q, id: q._id })),
      });
    } catch (error) {
      console.error('listByBroker quote requests error:', error);
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
        contactId,
        companyName,
        siteAddress,
        wasteType,
        frequency,
        estimatedValue,
        description,
        notes,
        status,
        submit,
      } = req.body;

      if (!leadId) {
        return res.status(400).json({ success: false, message: 'leadId is required' });
      }

      const lead = await BrokerLead.findOne({ _id: leadId, brokerId });
      if (!lead) {
        return res.status(404).json({ success: false, message: 'Lead not found for this broker' });
      }

      if (contactId) {
        const contact = await BrokerContact.findOne({ _id: contactId, brokerId });
        if (!contact) {
          return res.status(404).json({ success: false, message: 'Contact not found for this broker' });
        }
      }

      const referenceCode = await nextReferenceCode(BrokerQuoteRequest, 'QR');
      const actorName = req.user?.username || req.user?.firstName || 'User';
      const initialStatus =
        submit || status === 'Submitted' ? 'Submitted' : status && QUOTE_REQUEST_STATUSES.includes(status) ? status : 'Draft';

      const quote = new BrokerQuoteRequest({
        brokerId,
        leadId,
        contactId: contactId || null,
        referenceCode,
        status: initialStatus,
        companyName: companyName || lead.companyName,
        siteAddress: siteAddress || '',
        wasteType: wasteType || lead.wasteType || '',
        frequency: frequency || lead.frequency || '',
        estimatedValue: estimatedValue != null ? Number(estimatedValue) : lead.pipelineValue || 0,
        description: description || '',
        notes: notes || '',
        submittedAt: initialStatus === 'Submitted' ? new Date() : null,
        activityLog: [
          {
            action: initialStatus === 'Submitted' ? 'Quote request submitted' : 'Quote request created',
            detail: referenceCode,
            actorName,
            createdAt: new Date(),
          },
        ],
      });

      await quote.save();

      if (initialStatus === 'Submitted') {
        lead.status = 'QuotationSent';
        if (!lead.activityLog) lead.activityLog = [];
        lead.activityLog.unshift({
          action: 'Quote request submitted',
          detail: referenceCode,
          actorName,
          createdAt: new Date(),
        });
        await lead.save();
      }

      if (initialStatus === 'Submitted') {
        const companyLabel = quote.companyName || lead.companyName;
        await notifyBrokerOrg(brokerId, {
          type: 'Quotations',
          message: `Quote ${referenceCode} created for ${companyLabel}`,
          senderName: actorName,
          metadata: {
            type: 'Quotations',
            brokerId: String(brokerId),
            leadId: String(leadId),
            quoteRequestId: String(quote._id),
          },
          emailSubject: `New quote request: ${referenceCode}`,
          emailHtml: `<p>Hello,</p><p>A new quote request <strong>${referenceCode}</strong> was created for <strong>${companyLabel}</strong>.</p><p>Created by: ${actorName}</p>`,
        });

        try {
          const ctx = await loadBrokerSyncContext(brokerId, leadId);
          if (ctx) {
            await syncBrokerQuoteToMainSystem({
              quote,
              lead: ctx.lead,
              broker: ctx.broker,
              actorName,
            });
          }
        } catch (syncError) {
          console.error('syncBrokerQuoteToMainSystem error:', syncError);
        }
      }

      return res.status(201).json({ success: true, data: { ...quote.toObject(), id: quote._id } });
    } catch (error) {
      console.error('create quote request error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  update: async (req, res) => {
    try {
      const quote = await BrokerQuoteRequest.findById(req.params.quoteRequestId);
      if (!quote) {
        return res.status(404).json({ success: false, message: 'Quote request not found' });
      }

      const allowed = [
        'contactId',
        'companyName',
        'siteAddress',
        'wasteType',
        'frequency',
        'estimatedValue',
        'quotedAmount',
        'description',
        'notes',
        'status',
      ];
      const actorName = req.user?.username || req.user?.firstName || 'User';
      const changes = [];

      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          if (key === 'status' && !QUOTE_REQUEST_STATUSES.includes(req.body[key])) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
          }
          if (key === 'estimatedValue' || key === 'quotedAmount') {
            quote[key] = req.body[key] != null ? Number(req.body[key]) : null;
          } else {
            quote[key] = req.body[key];
          }
          changes.push(key);
        }
      }

      if (req.body.submit && quote.status === 'Draft') {
        quote.status = 'Submitted';
        quote.submittedAt = new Date();
        changes.push('submit');
      }

      if (changes.length) {
        pushActivity(quote, 'Quote request updated', changes.join(', '), actorName);
      }

      if (quote.status === 'Submitted' && !quote.submittedAt) {
        quote.submittedAt = new Date();
      }

      await quote.save();

      if (quote.status === 'Submitted' || quote.status === 'Quoted') {
        const lead = await BrokerLead.findById(quote.leadId);
        if (lead) {
          if (quote.status === 'Submitted' && lead.status !== 'QuotationSent') {
            lead.status = 'QuotationSent';
          }
          if (quote.status === 'Quoted' && lead.status !== 'Negotiation') {
            lead.status = 'Negotiation';
          }
          await lead.save();
        }
      }

      if (changes.includes('submit') || (req.body.status === 'Submitted' && quote.status === 'Submitted')) {
        const companyLabel = quote.companyName || '';
        await notifyBrokerOrg(quote.brokerId, {
          type: 'Quotations',
          message: `Quote ${quote.referenceCode} submitted for ${companyLabel}`,
          senderName: actorName,
          metadata: {
            type: 'Quotations',
            brokerId: String(quote.brokerId),
            leadId: String(quote.leadId),
            quoteRequestId: String(quote._id),
          },
          emailSubject: `Quote submitted: ${quote.referenceCode}`,
          emailHtml: `<p>Hello,</p><p>Quote <strong>${quote.referenceCode}</strong> for <strong>${companyLabel}</strong> has been submitted.</p><p>Updated by: ${actorName}</p>`,
        });

        if (!quote.mainQuotationId) {
          try {
            const ctx = await loadBrokerSyncContext(quote.brokerId, quote.leadId);
            if (ctx) {
              await syncBrokerQuoteToMainSystem({
                quote,
                lead: ctx.lead,
                broker: ctx.broker,
                actorName,
              });
            }
          } catch (syncError) {
            console.error('syncBrokerQuoteToMainSystem error:', syncError);
          }
        }
      }

      return res.json({ success: true, data: { ...quote.toObject(), id: quote._id } });
    } catch (error) {
      console.error('update quote request error:', error);
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
      return brokerQuoteRequestCtrl.listByBroker(req, res);
    } catch (error) {
      console.error('listMine quote requests error:', error);
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
      return brokerQuoteRequestCtrl.create(req, res);
    } catch (error) {
      console.error('createMine quote request error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  updateMine: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }
      const quote = await BrokerQuoteRequest.findById(req.params.quoteRequestId);
      if (!quote || String(quote.brokerId) !== String(brokerId)) {
        return res.status(404).json({ success: false, message: 'Quote request not found' });
      }
      return brokerQuoteRequestCtrl.update(req, res);
    } catch (error) {
      console.error('updateMine quote request error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },
};

module.exports = brokerQuoteRequestCtrl;
