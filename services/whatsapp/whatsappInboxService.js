const WhatsAppConversation = require('../../models/WhatsAppConversation');
const WhatsAppMessage = require('../../models/WhatsAppMessage');
const Task = require('../../models/Task');
const { User } = require('../../models/User');
const meta = require('./whatsappMetaService');
const { emitToAllOnlineAdmins, emitNotificationToUser } = require('../../socket');

function previewFromMessage(type, body, caption) {
  if (type === 'text') return String(body || '').slice(0, 160);
  if (caption) return String(caption).slice(0, 160);
  const labels = {
    image: '[Image]',
    audio: '[Audio]',
    video: '[Video]',
    document: '[Document]',
    sticker: '[Sticker]',
    location: '[Location]',
    contacts: '[Contact]',
    template: '[Template]',
    reaction: '[Reaction]',
  };
  return labels[type] || `[${type || 'message'}]`;
}

function extractInboundPayload(msg = {}) {
  const type = msg.type || 'unknown';
  let body = '';
  let mediaId = null;
  let mediaMimeType = null;
  let mediaFilename = null;
  let caption = '';

  switch (type) {
    case 'text':
      body = msg.text?.body || '';
      break;
    case 'image':
      mediaId = msg.image?.id || null;
      mediaMimeType = msg.image?.mime_type || null;
      caption = msg.image?.caption || '';
      body = caption;
      break;
    case 'audio':
      mediaId = msg.audio?.id || null;
      mediaMimeType = msg.audio?.mime_type || null;
      break;
    case 'video':
      mediaId = msg.video?.id || null;
      mediaMimeType = msg.video?.mime_type || null;
      caption = msg.video?.caption || '';
      body = caption;
      break;
    case 'document':
      mediaId = msg.document?.id || null;
      mediaMimeType = msg.document?.mime_type || null;
      mediaFilename = msg.document?.filename || null;
      caption = msg.document?.caption || '';
      body = caption || mediaFilename || '';
      break;
    case 'sticker':
      mediaId = msg.sticker?.id || null;
      mediaMimeType = msg.sticker?.mime_type || null;
      break;
    case 'location':
      body = msg.location
        ? `${msg.location.latitude},${msg.location.longitude}`
        : '';
      break;
    case 'button':
      body = msg.button?.text || msg.button?.payload || '';
      break;
    case 'interactive':
      body =
        msg.interactive?.button_reply?.title ||
        msg.interactive?.list_reply?.title ||
        '';
      break;
    case 'reaction':
      body = msg.reaction?.emoji || '';
      break;
    default:
      body = '';
  }

  return { type, body, mediaId, mediaMimeType, mediaFilename, caption };
}

async function findOrCreateConversation({ waId, phoneNumber, profileName }) {
  const normalized = meta.normalizePhone(waId || phoneNumber);
  let conversation = await WhatsAppConversation.findOne({ waId: normalized });

  if (!conversation) {
    conversation = await WhatsAppConversation.create({
      waId: normalized,
      phoneNumber: normalized,
      profileName: profileName || '',
      displayName: profileName || normalized,
    });

    // Best-effort auto-link to latest matching task by phone
    try {
      const task = await Task.findOne({
        $or: [
          { phoneNumber: new RegExp(`${normalized.slice(-9)}$`) },
          { phoneNumber2: new RegExp(`${normalized.slice(-9)}$`) },
        ],
      })
        .sort({ createdAt: -1 })
        .select('_id email phoneNumber')
        .lean();

      if (task) {
        conversation.taskId = task._id;
        await conversation.save();
      }
    } catch (err) {
      console.warn('[WhatsApp] auto-link task failed:', err.message);
    }
  } else if (profileName && conversation.profileName !== profileName) {
    conversation.profileName = profileName;
    if (!conversation.displayName || conversation.displayName === conversation.phoneNumber) {
      conversation.displayName = profileName;
    }
    await conversation.save();
  }

  return conversation;
}

async function saveInboundMessage(conversation, msg, contactName) {
  const extracted = extractInboundPayload(msg);
  const timestamp = msg.timestamp
    ? new Date(Number(msg.timestamp) * 1000)
    : new Date();

  if (msg.id) {
    const existing = await WhatsAppMessage.findOne({ waMessageId: msg.id }).lean();
    if (existing) return { conversation, message: existing, created: false };
  }

  const message = await WhatsAppMessage.create({
    conversationId: conversation._id,
    waMessageId: msg.id || undefined,
    direction: 'inbound',
    type: extracted.type,
    body: extracted.body,
    mediaId: extracted.mediaId,
    mediaMimeType: extracted.mediaMimeType,
    mediaFilename: extracted.mediaFilename,
    caption: extracted.caption,
    status: 'delivered',
    raw: msg,
    timestamp,
  });

  conversation.lastMessageAt = timestamp;
  conversation.lastInboundAt = timestamp;
  conversation.lastMessageDirection = 'inbound';
  conversation.lastMessagePreview = previewFromMessage(
    extracted.type,
    extracted.body,
    extracted.caption
  );
  conversation.unreadCount = (conversation.unreadCount || 0) + 1;
  if (contactName) {
    conversation.profileName = contactName;
    if (!conversation.displayName) conversation.displayName = contactName;
  }
  await conversation.save();

  return { conversation, message, created: true };
}

async function applyStatusUpdate(statusObj = {}) {
  if (!statusObj.id) return null;

  const message = await WhatsAppMessage.findOne({ waMessageId: statusObj.id });
  if (!message) return null;

  const map = {
    sent: 'sent',
    delivered: 'delivered',
    read: 'read',
    failed: 'failed',
  };
  const next = map[statusObj.status];
  if (next) {
    message.status = next;
    if (statusObj.errors?.length) {
      message.statusError =
        statusObj.errors[0]?.message || JSON.stringify(statusObj.errors[0]);
    }
    await message.save();
  }
  return message;
}

async function processWebhookPayload(payload) {
  const results = { messages: 0, statuses: 0 };

  if (!payload || payload.object !== 'whatsapp_business_account') {
    return results;
  }

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};
      const contactsByWaId = {};
      for (const c of value.contacts || []) {
        contactsByWaId[c.wa_id] = c.profile?.name || '';
      }

      for (const msg of value.messages || []) {
        const waId = meta.normalizePhone(msg.from);
        const conversation = await findOrCreateConversation({
          waId,
          phoneNumber: waId,
          profileName: contactsByWaId[msg.from] || '',
        });

        const { message, created } = await saveInboundMessage(
          conversation,
          msg,
          contactsByWaId[msg.from]
        );

        if (created) {
          results.messages += 1;
          try {
            await emitToAllOnlineAdmins('whatsapp:message', {
              conversationId: String(conversation._id),
              message,
              conversation,
            });
            await emitToAllOnlineAdmins('whatsapp:conversation', {
              conversation,
            });
          } catch (err) {
            console.warn('[WhatsApp] socket emit failed:', err.message);
          }

          notifyAdminsNewMessage(conversation, message).catch((err) => {
            console.warn('[WhatsApp] admin notify failed:', err.message);
          });

          // Best-effort read receipt
          if (msg.id) {
            meta.markMessageAsRead(msg.id).catch(() => {});
          }
        }
      }

      for (const status of value.statuses || []) {
        const updated = await applyStatusUpdate(status);
        if (updated) {
          results.statuses += 1;
          try {
            await emitToAllOnlineAdmins('whatsapp:message_status', {
              conversationId: String(updated.conversationId),
              message: updated,
            });
          } catch (_) {
            /* ignore */
          }
        }
      }
    }
  }

  return results;
}

async function notifyAdminsNewMessage(conversation, message) {
  const name =
    conversation.displayName ||
    conversation.profileName ||
    conversation.phoneNumber ||
    'WhatsApp client';
  const preview =
    message.body ||
    message.caption ||
    previewFromMessage(message.type, message.body, message.caption);
  const text = `New WhatsApp from ${name}: ${String(preview).slice(0, 120)}`;

  const admins = await User.find({ roleType: 'Admin' }).select('_id').lean();
  await Promise.all(
    admins.map((admin) =>
      emitNotificationToUser(admin._id.toString(), 'WhatsApp', text, name, {
        type: 'WhatsApp',
        conversationId: String(conversation._id),
        messageId: String(message._id),
        phoneNumber: conversation.phoneNumber,
      })
    )
  );
}

async function searchTasks(q, { limit = 20 } = {}) {
  const query = String(q || '').trim();
  if (!query || query.length < 2) {
    return [];
  }

  const digits = meta.normalizePhone(query);
  const or = [
    { firstName: new RegExp(query, 'i') },
    { lastName: new RegExp(query, 'i') },
    { email: new RegExp(query, 'i') },
    { orderNumber: new RegExp(query, 'i') },
  ];

  if (digits && digits.length >= 6) {
    const tail = digits.slice(-9);
    or.push(
      { phoneNumber: new RegExp(tail) },
      { phoneNumber2: new RegExp(tail) }
    );
  }

  // Also match "first last"
  const parts = query.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    or.push({
      $and: [
        { firstName: new RegExp(parts[0], 'i') },
        { lastName: new RegExp(parts.slice(1).join(' '), 'i') },
      ],
    });
  }

  return Task.find({ $or: or })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 20, 50))
    .select('orderNumber firstName lastName phoneNumber phoneNumber2 email date status taskStatus address')
    .lean();
}

async function listTemplates() {
  const data = await meta.listMessageTemplates();
  const templates = (data?.data || []).map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    language: t.language,
    category: t.category,
    components: t.components || [],
  }));
  return { templates, recommended: [
    { name: 'hello_world', language: 'en_US', purpose: 'Meta default test template' },
    { name: 'booking_reminder', language: 'en', purpose: 'Remind client before job (create in Meta)' },
    { name: 'on_the_way', language: 'en', purpose: 'Driver on the way (create in Meta)' },
    { name: 'review_request', language: 'en', purpose: 'Ask for review after job (create in Meta)' },
  ]};
}

async function listConversations({ search, limit = 50, skip = 0 } = {}) {
  const query = {};
  if (search) {
    const q = String(search).trim();
    const digits = meta.normalizePhone(q);
    query.$or = [
      { displayName: new RegExp(q, 'i') },
      { profileName: new RegExp(q, 'i') },
      { phoneNumber: new RegExp(digits || q, 'i') },
      { waId: new RegExp(digits || q, 'i') },
    ];
  }

  const [items, total] = await Promise.all([
    WhatsAppConversation.find(query)
      .sort({ lastMessageAt: -1 })
      .skip(Number(skip) || 0)
      .limit(Math.min(Number(limit) || 50, 100))
      .populate('taskId', 'orderNumber firstName lastName email phoneNumber status date taskStatus')
      .populate('customerId', 'email customNote')
      .populate('assignedAdminId', 'username email')
      .lean(),
    WhatsAppConversation.countDocuments(query),
  ]);

  return { items, total };
}

async function getConversation(id) {
  return WhatsAppConversation.findById(id)
    .populate('taskId', 'orderNumber firstName lastName email phoneNumber status date taskStatus address')
    .populate('customerId', 'email customNote')
    .populate('assignedAdminId', 'username email')
    .lean();
}

async function listMessages(conversationId, { limit = 100, before } = {}) {
  const query = { conversationId };
  if (before) {
    query.timestamp = { $lt: new Date(before) };
  }

  const messages = await WhatsAppMessage.find(query)
    .sort({ timestamp: -1 })
    .limit(Math.min(Number(limit) || 100, 200))
    .lean();

  return messages.reverse();
}

async function markConversationRead(conversationId) {
  return WhatsAppConversation.findByIdAndUpdate(
    conversationId,
    { $set: { unreadCount: 0 } },
    { new: true }
  );
}

async function linkConversation(conversationId, { taskId, customerId, displayName }) {
  const update = {};
  if (taskId !== undefined) update.taskId = taskId || null;
  if (customerId !== undefined) update.customerId = customerId || null;
  if (displayName !== undefined) update.displayName = String(displayName || '').trim();

  return WhatsAppConversation.findByIdAndUpdate(
    conversationId,
    { $set: update },
    { new: true }
  )
    .populate('taskId', 'orderNumber firstName lastName email phoneNumber status date taskStatus address')
    .populate('customerId', 'email customNote');
}

async function startConversation({ phoneNumber, displayName, taskId, customerId }) {
  const waId = meta.normalizePhone(phoneNumber);
  if (!waId) {
    const err = new Error('phoneNumber is required');
    err.status = 400;
    throw err;
  }

  let conversation = await WhatsAppConversation.findOne({ waId });
  if (!conversation) {
    conversation = await WhatsAppConversation.create({
      waId,
      phoneNumber: waId,
      displayName: displayName || waId,
      taskId: taskId || null,
      customerId: customerId || null,
    });
  } else {
    if (displayName) conversation.displayName = displayName;
    if (taskId !== undefined) conversation.taskId = taskId || null;
    if (customerId !== undefined) conversation.customerId = customerId || null;
    await conversation.save();
  }

  return conversation;
}

async function sendOutboundText(conversationId, text, adminId) {
  const conversation = await WhatsAppConversation.findById(conversationId);
  if (!conversation) {
    const err = new Error('Conversation not found');
    err.status = 404;
    throw err;
  }

  const body = String(text || '').trim();
  if (!body) {
    const err = new Error('Message text is required');
    err.status = 400;
    throw err;
  }

  const apiRes = await meta.sendTextMessage(conversation.waId, body);
  const waMessageId = apiRes?.messages?.[0]?.id;

  const message = await WhatsAppMessage.create({
    conversationId: conversation._id,
    waMessageId: waMessageId || undefined,
    direction: 'outbound',
    type: 'text',
    body,
    status: 'sent',
    sentByAdminId: adminId || null,
    timestamp: new Date(),
    raw: apiRes,
  });

  conversation.lastMessageAt = message.timestamp;
  conversation.lastMessageDirection = 'outbound';
  conversation.lastMessagePreview = previewFromMessage('text', body);
  await conversation.save();

  try {
    await emitToAllOnlineAdmins('whatsapp:message', {
      conversationId: String(conversation._id),
      message,
      conversation,
    });
  } catch (_) {
    /* ignore */
  }

  return { conversation, message, apiRes };
}

async function sendOutboundTemplate(conversationId, { templateName, languageCode, components }, adminId) {
  const conversation = await WhatsAppConversation.findById(conversationId);
  if (!conversation) {
    const err = new Error('Conversation not found');
    err.status = 404;
    throw err;
  }

  const name = String(templateName || '').trim();
  if (!name) {
    const err = new Error('templateName is required');
    err.status = 400;
    throw err;
  }

  const apiRes = await meta.sendTemplateMessage(
    conversation.waId,
    name,
    languageCode || 'en_US',
    components || []
  );
  const waMessageId = apiRes?.messages?.[0]?.id;

  const message = await WhatsAppMessage.create({
    conversationId: conversation._id,
    waMessageId: waMessageId || undefined,
    direction: 'outbound',
    type: 'template',
    body: `Template: ${name}`,
    templateName: name,
    status: 'sent',
    sentByAdminId: adminId || null,
    timestamp: new Date(),
    raw: apiRes,
  });

  conversation.lastMessageAt = message.timestamp;
  conversation.lastMessageDirection = 'outbound';
  conversation.lastMessagePreview = previewFromMessage('template', message.body);
  await conversation.save();

  return { conversation, message, apiRes };
}

async function sendOutboundMedia(
  conversationId,
  { buffer, mimeType, filename, caption },
  adminId
) {
  const conversation = await WhatsAppConversation.findById(conversationId);
  if (!conversation) {
    const err = new Error('Conversation not found');
    err.status = 404;
    throw err;
  }

  if (!buffer || !buffer.length) {
    const err = new Error('File is required');
    err.status = 400;
    throw err;
  }

  const type = meta.mimeToWhatsAppType(mimeType);
  const uploadRes = await meta.uploadMedia(buffer, mimeType, filename || 'file');
  const mediaId = uploadRes?.id;
  if (!mediaId) {
    const err = new Error('Media upload did not return an id');
    err.status = 502;
    throw err;
  }

  const apiRes = await meta.sendMediaMessage(conversation.waId, {
    type,
    mediaId,
    caption: caption || undefined,
    filename: type === 'document' ? filename : undefined,
  });
  const waMessageId = apiRes?.messages?.[0]?.id;

  const message = await WhatsAppMessage.create({
    conversationId: conversation._id,
    waMessageId: waMessageId || undefined,
    direction: 'outbound',
    type,
    body: caption || filename || '',
    caption: caption || '',
    mediaId,
    mediaMimeType: mimeType || null,
    mediaFilename: filename || null,
    status: 'sent',
    sentByAdminId: adminId || null,
    timestamp: new Date(),
    raw: { upload: uploadRes, send: apiRes },
  });

  conversation.lastMessageAt = message.timestamp;
  conversation.lastMessageDirection = 'outbound';
  conversation.lastMessagePreview = previewFromMessage(type, message.body, caption);
  await conversation.save();

  try {
    await emitToAllOnlineAdmins('whatsapp:message', {
      conversationId: String(conversation._id),
      message,
      conversation,
    });
  } catch (_) {
    /* ignore */
  }

  return { conversation, message, apiRes };
}

module.exports = {
  processWebhookPayload,
  listConversations,
  getConversation,
  listMessages,
  markConversationRead,
  linkConversation,
  startConversation,
  sendOutboundText,
  sendOutboundTemplate,
  sendOutboundMedia,
  searchTasks,
  listTemplates,
  findOrCreateConversation,
  previewFromMessage,
};
