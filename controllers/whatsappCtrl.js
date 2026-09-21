const crypto = require('crypto');
const meta = require('../services/whatsapp/whatsappMetaService');
const inbox = require('../services/whatsapp/whatsappInboxService');

function handleError(res, err, fallback = 'WhatsApp error') {
  let status = err.status || err.statusCode || 500;
  // Never forward Meta auth failures as HTTP 401 — the BO treats 401 as session expiry
  // and forces logout. Map upstream auth/permission errors to 502 instead.
  if (status === 401 || status === 403) {
    status = 502;
  }
  console.error('[WhatsApp]', err.message, err.details || '');
  return res.status(status).json({
    success: false,
    message: err.message || fallback,
    details: err.details || undefined,
  });
}

/** GET webhook verification (Meta challenge) */
exports.verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const { verifyToken } = meta.getConfig();

  if (mode === 'subscribe' && token && verifyToken && token === verifyToken) {
    return res.status(200).send(challenge);
  }

  return res.status(403).send('Forbidden');
};

/** POST webhook events */
exports.receiveWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-hub-signature-256'];
    const rawBody = req.rawBody;

    if (rawBody && !meta.verifyWebhookSignature(rawBody, signature)) {
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    // Acknowledge quickly; process async-safe (await for reliability in serverless-less node)
    const results = await inbox.processWebhookPayload(req.body);
    return res.status(200).json({ success: true, ...results });
  } catch (err) {
    console.error('[WhatsApp] webhook error:', err);
    // Still 200 to avoid Meta retries storm on our bugs; log for investigation
    return res.status(200).json({ success: false, message: err.message });
  }
};

exports.getStatus = async (req, res) => {
  try {
    const cfg = meta.getConfig();
    const temporaryTokenLikely = meta.looksLikeTemporaryToken(cfg.token);
    return res.json({
      success: true,
      configured: Boolean(cfg.token && cfg.phoneNumberId),
      phoneNumberId: cfg.phoneNumberId || null,
      businessAccountId: cfg.businessAccountId || null,
      apiVersion: cfg.apiVersion,
      hasAppSecret: Boolean(cfg.appSecret),
      hasVerifyToken: Boolean(cfg.verifyToken),
      temporaryTokenLikely,
      permanentTokenHint: temporaryTokenLikely
        ? 'Create a System User token in Meta Business Settings, set WHATSAPP_TOKEN, then set WHATSAPP_TOKEN_PERMANENT=true'
        : 'WHATSAPP_TOKEN_PERMANENT=true — token treated as permanent',
    });
  } catch (err) {
    return handleError(res, err);
  }
};

exports.searchTasks = async (req, res) => {
  try {
    const tasks = await inbox.searchTasks(req.query.q, { limit: req.query.limit });
    return res.json({ success: true, tasks });
  } catch (err) {
    return handleError(res, err);
  }
};

exports.listTemplates = async (req, res) => {
  try {
    const data = await inbox.listTemplates();
    return res.json({ success: true, ...data });
  } catch (err) {
    // Soft-fail: return empty list so the inbox still loads if Meta token is bad
    console.error('[WhatsApp] listTemplates failed:', err.message);
    return res.status(200).json({
      success: false,
      templates: [],
      recommended: [
        { name: 'hello_world', language: 'en_US', purpose: 'Meta default test template' },
        { name: 'booking_reminder', language: 'en', purpose: 'Remind client before job (create in Meta)' },
        { name: 'on_the_way', language: 'en', purpose: 'Driver on the way (create in Meta)' },
        { name: 'review_request', language: 'en', purpose: 'Ask for review after job (create in Meta)' },
      ],
      message: err.message || 'Failed to load templates from Meta',
    });
  }
};

exports.listConversations = async (req, res) => {
  try {
    const data = await inbox.listConversations({
      search: req.query.search,
      limit: req.query.limit,
      skip: req.query.skip,
    });
    return res.json({ success: true, ...data });
  } catch (err) {
    return handleError(res, err);
  }
};

exports.getConversation = async (req, res) => {
  try {
    const conversation = await inbox.getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    return res.json({ success: true, conversation });
  } catch (err) {
    return handleError(res, err);
  }
};

exports.listMessages = async (req, res) => {
  try {
    const conversation = await inbox.getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    const messages = await inbox.listMessages(req.params.id, {
      limit: req.query.limit,
      before: req.query.before,
    });
    return res.json({ success: true, messages, conversation });
  } catch (err) {
    return handleError(res, err);
  }
};

exports.markRead = async (req, res) => {
  try {
    const conversation = await inbox.markConversationRead(req.params.id);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    return res.json({ success: true, conversation });
  } catch (err) {
    return handleError(res, err);
  }
};

exports.linkConversation = async (req, res) => {
  try {
    const conversation = await inbox.linkConversation(req.params.id, {
      taskId: req.body.taskId,
      customerId: req.body.customerId,
      displayName: req.body.displayName,
    });
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    return res.json({ success: true, conversation });
  } catch (err) {
    return handleError(res, err);
  }
};

exports.startConversation = async (req, res) => {
  try {
    const conversation = await inbox.startConversation({
      phoneNumber: req.body.phoneNumber,
      displayName: req.body.displayName,
      taskId: req.body.taskId,
      customerId: req.body.customerId,
    });
    return res.status(201).json({ success: true, conversation });
  } catch (err) {
    return handleError(res, err);
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const { text, templateName, languageCode, components } = req.body || {};
    const adminId = req.user?._id || req.user?.id;

    if (templateName) {
      const result = await inbox.sendOutboundTemplate(
        req.params.id,
        { templateName, languageCode, components },
        adminId
      );
      return res.json({ success: true, ...result });
    }

    const result = await inbox.sendOutboundText(req.params.id, text, adminId);
    return res.json({ success: true, ...result });
  } catch (err) {
    return handleError(res, err);
  }
};

exports.sendMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'file is required' });
    }

    const mimeType = req.file.mimetype || 'application/octet-stream';
    const type = meta.mimeToWhatsAppType(mimeType);
    const size = req.file.size || req.file.buffer?.length || 0;

    const limits = {
      image: 5 * 1024 * 1024,
      video: 16 * 1024 * 1024,
      audio: 16 * 1024 * 1024,
      document: 100 * 1024 * 1024,
    };
    if (size > (limits[type] || limits.document)) {
      return res.status(400).json({
        success: false,
        message: `File too large for WhatsApp ${type} (max ${Math.round((limits[type] || limits.document) / (1024 * 1024))}MB)`,
      });
    }

    const adminId = req.user?._id || req.user?.id;
    const result = await inbox.sendOutboundMedia(
      req.params.id,
      {
        buffer: req.file.buffer,
        mimeType,
        filename: req.file.originalname || 'file',
        caption: req.body?.caption || '',
      },
      adminId
    );
    return res.json({ success: true, ...result });
  } catch (err) {
    return handleError(res, err, 'Failed to send media');
  }
};

exports.getMedia = async (req, res) => {
  try {
    const { buffer, mimeType } = await meta.downloadMedia(req.params.mediaId);
    const filename = req.query.filename
      ? String(req.query.filename)
      : `whatsapp-media-${req.params.mediaId}`;

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (req.query.download === '1') {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename.replace(/"/g, '')}"`
      );
    } else {
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${filename.replace(/"/g, '')}"`
      );
    }
    return res.send(buffer);
  } catch (err) {
    return handleError(res, err, 'Failed to fetch media');
  }
};

/** Dev helper: unique verify challenge echo */
exports.health = (req, res) => {
  res.json({
    success: true,
    service: 'whatsapp',
    nonce: crypto.randomBytes(4).toString('hex'),
  });
};
