const BrokerContact = require('../models/BrokerContact');
const BrokerLead = require('../models/BrokerLead');
const { resolveBrokerIdForUser } = require('../utils/brokerScope');

const { escapeRegex } = require('../utils/brokerHelpers');

function buildContactFilter(brokerId, query = {}) {
  const filter = { brokerId };
  if (query.leadId) filter.leadId = query.leadId;
  if (query.keyword && String(query.keyword).trim()) {
    const regex = new RegExp(escapeRegex(String(query.keyword).trim()), 'i');
    filter.$or = [
      { name: regex },
      { email: regex },
      { phone: regex },
      { companyName: regex },
      { jobTitle: regex },
    ];
  }
  return filter;
}

const brokerContactCtrl = {
  listByBroker: async (req, res) => {
    try {
      const brokerId = req.params.brokerId || req.params.id;
      if (!brokerId) {
        return res.status(400).json({ success: false, message: 'brokerId is required' });
      }
      const contacts = await BrokerContact.find(buildContactFilter(brokerId, req.query))
        .sort({ updatedAt: -1 })
        .lean();
      return res.json({
        success: true,
        data: contacts.map((c) => ({ ...c, id: c._id })),
      });
    } catch (error) {
      console.error('listByBroker contacts error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  create: async (req, res) => {
    try {
      const brokerId = req.params.brokerId || req.params.id || req.body.brokerId;
      if (!brokerId) {
        return res.status(400).json({ success: false, message: 'brokerId is required' });
      }

      const { leadId, name, email, phone, jobTitle, companyName, notes, isPrimary } = req.body;
      if (!name) {
        return res.status(400).json({ success: false, message: 'name is required' });
      }

      if (leadId) {
        const lead = await BrokerLead.findOne({ _id: leadId, brokerId });
        if (!lead) {
          return res.status(404).json({ success: false, message: 'Lead not found for this broker' });
        }
      }

      if (isPrimary && leadId) {
        await BrokerContact.updateMany({ brokerId, leadId }, { isPrimary: false });
      }

      const contact = await BrokerContact.create({
        brokerId,
        leadId: leadId || null,
        name,
        email: email || '',
        phone: phone || '',
        jobTitle: jobTitle || '',
        companyName: companyName || '',
        notes: notes || '',
        isPrimary: !!isPrimary,
      });

      return res.status(201).json({ success: true, data: { ...contact.toObject(), id: contact._id } });
    } catch (error) {
      console.error('create contact error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  update: async (req, res) => {
    try {
      const contact = await BrokerContact.findById(req.params.contactId);
      if (!contact) {
        return res.status(404).json({ success: false, message: 'Contact not found' });
      }

      const allowed = ['leadId', 'name', 'email', 'phone', 'jobTitle', 'companyName', 'notes', 'isPrimary'];
      for (const key of allowed) {
        if (req.body[key] !== undefined) contact[key] = req.body[key];
      }

      if (contact.isPrimary && contact.leadId) {
        await BrokerContact.updateMany(
          { brokerId: contact.brokerId, leadId: contact.leadId, _id: { $ne: contact._id } },
          { isPrimary: false }
        );
      }

      await contact.save();
      return res.json({ success: true, data: { ...contact.toObject(), id: contact._id } });
    } catch (error) {
      console.error('update contact error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  remove: async (req, res) => {
    try {
      const contact = await BrokerContact.findByIdAndDelete(req.params.contactId);
      if (!contact) {
        return res.status(404).json({ success: false, message: 'Contact not found' });
      }
      return res.json({ success: true, message: 'Contact deleted' });
    } catch (error) {
      console.error('remove contact error:', error);
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
      return brokerContactCtrl.listByBroker(req, res);
    } catch (error) {
      console.error('listMine contacts error:', error);
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
      return brokerContactCtrl.create(req, res);
    } catch (error) {
      console.error('createMine contact error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  updateMine: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }
      const contact = await BrokerContact.findById(req.params.contactId);
      if (!contact || String(contact.brokerId) !== String(brokerId)) {
        return res.status(404).json({ success: false, message: 'Contact not found' });
      }
      return brokerContactCtrl.update(req, res);
    } catch (error) {
      console.error('updateMine contact error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },
};

module.exports = brokerContactCtrl;
