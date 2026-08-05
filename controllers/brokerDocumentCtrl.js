const BrokerDocument = require('../models/BrokerDocument');
const BrokerLead = require('../models/BrokerLead');
const { DOCUMENT_TYPES } = require('../models/BrokerDocument');
const { resolveBrokerIdForUser } = require('../utils/brokerScope');

const { escapeRegex, nextReferenceCode } = require('../utils/brokerHelpers');

function buildFilter(brokerId, query = {}) {
  const filter = { brokerId };
  if (query.type && query.type !== 'all') filter.type = query.type;
  if (query.leadId) filter.leadId = query.leadId;
  if (query.quoteRequestId) filter.quoteRequestId = query.quoteRequestId;
  if (query.negotiationId) filter.negotiationId = query.negotiationId;
  if (query.orderId) filter.orderId = query.orderId;
  if (query.keyword && String(query.keyword).trim()) {
    const regex = new RegExp(escapeRegex(String(query.keyword).trim()), 'i');
    filter.$or = [{ companyName: regex }, { title: regex }, { referenceCode: regex }];
  }
  return filter;
}

const brokerDocumentCtrl = {
  upload: async (req, res) => {
    try {
      const brokerId = req.params.brokerId || req.params.id || req.body.brokerId;
      if (!brokerId) {
        return res.status(400).json({ success: false, message: 'brokerId is required' });
      }

      const {
        leadId,
        quoteRequestId,
        negotiationId,
        orderId,
        taskId,
        companyName,
        title,
        type,
        notes,
      } = req.body;

      if (!leadId) {
        return res.status(400).json({ success: false, message: 'leadId is required' });
      }
      if (!title || !String(title).trim()) {
        return res.status(400).json({ success: false, message: 'title is required' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'file is required' });
      }

      const lead = await BrokerLead.findOne({ _id: leadId, brokerId });
      if (!lead) {
        return res.status(404).json({ success: false, message: 'Lead not found for this broker' });
      }

      const actorName = req.user?.username || req.user?.firstName || 'User';
      const referenceCode = await nextReferenceCode(BrokerDocument, 'DOC');
      const normalizedType = DOCUMENT_TYPES.includes(type) ? type : 'Other';

      const document = await BrokerDocument.create({
        brokerId,
        leadId,
        quoteRequestId: quoteRequestId || null,
        negotiationId: negotiationId || null,
        orderId: orderId || null,
        taskId: taskId || null,
        referenceCode,
        companyName: companyName || lead.companyName,
        title: String(title).trim(),
        type: normalizedType,
        mimeType: req.file.mimetype || '',
        fileName: req.file.originalname || req.file.filename || 'document',
        fileUrl: req.file.path,
        fileSize: Number(req.file.size || 0),
        notes: notes || '',
        activityLog: [
          {
            action: 'Document uploaded',
            detail: referenceCode,
            actorName,
            createdAt: new Date(),
          },
        ],
      });

      if (!lead.activityLog) lead.activityLog = [];
      lead.activityLog.unshift({
        action: 'Document uploaded',
        detail: `${referenceCode}: ${document.title}`,
        actorName,
        createdAt: new Date(),
      });
      await lead.save();

      return res.status(201).json({
        success: true,
        data: { ...document.toObject(), id: document._id },
      });
    } catch (error) {
      console.error('upload document error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  listByBroker: async (req, res) => {
    try {
      const brokerId = req.params.brokerId || req.params.id;
      if (!brokerId) {
        return res.status(400).json({ success: false, message: 'brokerId is required' });
      }
      const items = await BrokerDocument.find(buildFilter(brokerId, req.query))
        .sort({ updatedAt: -1 })
        .lean();
      return res.json({
        success: true,
        data: items.map((d) => ({ ...d, id: d._id })),
      });
    } catch (error) {
      console.error('listByBroker documents error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  remove: async (req, res) => {
    try {
      const item = await BrokerDocument.findByIdAndDelete(req.params.documentId);
      if (!item) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }
      return res.json({ success: true, message: 'Document deleted' });
    } catch (error) {
      console.error('remove document error:', error);
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
      return brokerDocumentCtrl.listByBroker(req, res);
    } catch (error) {
      console.error('listMine documents error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  uploadMine: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }
      req.params.brokerId = String(brokerId);
      return brokerDocumentCtrl.upload(req, res);
    } catch (error) {
      console.error('uploadMine document error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  removeMine: async (req, res) => {
    try {
      const brokerId = await resolveBrokerIdForUser(req.user);
      if (!brokerId) {
        return res.status(404).json({ success: false, message: 'No broker profile linked to this user' });
      }
      const item = await BrokerDocument.findById(req.params.documentId);
      if (!item || String(item.brokerId) !== String(brokerId)) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }
      return brokerDocumentCtrl.remove(req, res);
    } catch (error) {
      console.error('removeMine document error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },
};

module.exports = brokerDocumentCtrl;
