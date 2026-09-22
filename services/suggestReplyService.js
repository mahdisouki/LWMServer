const axios = require('axios');
const ThreadClassification = require('../models/ThreadClassification');
const {
  getSuggestReplyThreadContext,
  getLatestMessageIdInThread,
} = require('./gmailService');
const { detectItemsFromGmailMessage } = require('./detectionAiService');

const PYTHON_SERVER = (
  process.env.PYTHON_SERVER || 'http://localhost:8001'
).replace(/\/$/, '');

const SUGGEST_REPLY_URL = `${PYTHON_SERVER}/suggest_reply`;

const SUGGEST_REPLY_TIMEOUT_MS =
  Number(process.env.SUGGEST_REPLY_TIMEOUT_MS) || 60000;

function buildContentMainForSuggest(contentMain, photoCount) {
  const text = String(contentMain || '').trim();
  const count = Number(photoCount) || 0;

  const photoNote =
    count > 0
      ? count === 1
        ? '1 photo has been sent.'
        : `${count} photos have been sent.`
      : '';

  if (text && photoNote) return `${text} ${photoNote}`;
  if (text) return text;
  return photoNote;
}

async function callPythonSuggestReply(pythonPayload, fallbackCategory, messageContext) {


  const res = await axios.post(SUGGEST_REPLY_URL, pythonPayload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: SUGGEST_REPLY_TIMEOUT_MS,
  });

  const data = res.data || {};
  const category = data.category ?? fallbackCategory;
  const threadId = data.threadId || pythonPayload.message?.threadId;
  const messageId = data.messageId || pythonPayload.message?.messageId;
  const from = messageContext?.from || null;

  // Quote items-only: return only pricing/item fields (no reply drafts).
  if (category === 'quote') {
    return {
      category,
      phase: data.phase ?? null,
      reason: data.reason ?? null,
      draft_source: data.draft_source ?? null,
      items: Array.isArray(data.items) ? data.items : [],
      collection_side: data.collection_side ?? null,
      needs_dismantling: Boolean(data.needs_dismantling),
      extraction_method: data.extraction_method ?? null,
      unmatched_items: Array.isArray(data.unmatched_items)
        ? data.unmatched_items
        : [],
      llm_error: data.llm_error ?? null,
      threadId,
      messageId,
      from,
    };
  }

  const suggestedReplies = Array.isArray(data.suggested_replies)
    ? data.suggested_replies.filter((x) => typeof x === 'string' && x.trim())
    : [];

  return {
    category,
    phase: data.phase ?? null,
    missing_slots: Array.isArray(data.missing_slots) ? data.missing_slots : [],
    suggested_replies: suggestedReplies,
    suggested_price_gbp:
      typeof data.suggested_price_gbp === 'number'
        ? data.suggested_price_gbp
        : null,
    price_type: data.price_type ?? null,
    reason: data.reason ?? null,
    draft_source: data.draft_source ?? null,
    customer_name: data.customer_name ?? null,
    order_ref: data.order_ref ?? null,
    is_service_failure:
      typeof data.is_service_failure === 'boolean'
        ? data.is_service_failure
        : null,
    is_follow_up:
      typeof data.is_follow_up === 'boolean' ? data.is_follow_up : null,
    language: data.language ?? null,
    threadId,
    messageId,
    from,
  };
}

async function getCategoryForThread(_adminId, threadId) {
  const classification = await ThreadClassification.findOne({
    threadId,
    status: 'done',
  }).lean();
  return classification?.aiCategory || 'other';
}

const OUTBOUND_FROM_LABEL = 'LWM / Support';

function formatFromForSuggestReply(fromHeader, fromAddress, direction) {
  const email = (fromAddress || extractEmailAddressFromHeader(fromHeader) || '')
    .trim()
    .toLowerCase();

  if (direction === 'outbound') {
    return email ? `${OUTBOUND_FROM_LABEL} (${email})` : OUTBOUND_FROM_LABEL;
  }

  const header = String(fromHeader || '').trim();
  if (header) return header;
  return email;
}

function detectQuotationForm(subject, contentMain) {
  const text = `${subject || ''} ${contentMain || ''}`.toLowerCase();
  return (
    text.includes('new quotation request') ||
    (text.includes('quotation request') && text.includes('first name:'))
  );
}

function normalizeToForSuggest(toHeader) {
  const raw = String(toHeader || '').trim();
  return raw || null;
}

function buildThreadHistoryForPython(threadHistory, targetPhotoCount = null) {
  if (!Array.isArray(threadHistory) || !threadHistory.length) return [];

  return threadHistory.map((row, index) => {
    const isTarget = index === threadHistory.length - 1;
    const photoCount =
      isTarget && targetPhotoCount != null ? targetPhotoCount : row.photoCount;
    return {
      direction: row.direction,
      from: formatFromForSuggestReply(
        row.fromHeader,
        row.from_address,
        row.direction
      ),
      subject: row.subject || '',
      contentMain: buildContentMainForSuggest(row.contentMain, photoCount),
      sent_at: row.internalDate || null,
    };
  });
}

function buildPythonSuggestPayload({
  threadId,
  messageId,
  target,
  threadHistory,
  category,
  businessEmail,
  detectedItems = [],
}) {
  const fromAddress = extractEmailAddressFromHeader(target.from);
  const direction = isOutboundFromAddress(fromAddress, businessEmail)
    ? 'outbound'
    : 'inbound';
  const fromDisplay = formatFromForSuggestReply(
    target.from,
    fromAddress,
    direction
  );

  const contentMain = buildContentMainForSuggest(
    target.contentMain,
    target.photoCount
  );

  return {
    message: {
      id: target.id,
      messageId: target.id,
      threadId,
      from: fromDisplay,
      to: normalizeToForSuggest(target.to),
      subject: target.subject || '',
      contentMain,
      direction,
      is_quotation_form: detectQuotationForm(target.subject, contentMain),
      aiCategory: category,
    },
    thread: buildThreadHistoryForPython(threadHistory, target.photoCount),
    detectedItems,
  };
}

function extractEmailAddressFromHeader(fromHeader) {
  if (!fromHeader) return '';
  const m = String(fromHeader).match(/<([^>]+)>/);
  if (m) return m[1].trim().toLowerCase();
  if (/@/.test(fromHeader)) return String(fromHeader).trim().toLowerCase();
  return '';
}

function isOutboundFromAddress(fromAddress, businessEmail) {
  const addr = (fromAddress || '').toLowerCase().trim();
  if (!addr) return false;
  if (businessEmail && addr === businessEmail) return true;
  const domain = addr.split('@')[1] || '';
  return domain.includes('londonwaste');
}

async function buildSuggestReplyPythonPayloadForThread(
  adminId,
  threadId,
  messageId
) {
  const ctx = await getSuggestReplyThreadContext(adminId, threadId, messageId);
  const category = await getCategoryForThread(adminId, ctx.threadId);

  const targetGmailMessage = (ctx.messagesThroughTarget || []).find(
    (m) => m.id === ctx.messageId
  );

  let detectedItems = [];
  let detectionImageCount = Number(ctx.target?.photoCount) || 0;

  if (targetGmailMessage) {
    const detection = await detectItemsFromGmailMessage(
      adminId,
      targetGmailMessage
    );
    detectedItems = detection.items?.length
      ? detection.items
      : (detection.labels || []).map((name) => ({ name, count: 1 }));
    detectionImageCount = Math.max(
      detectionImageCount,
      Number(detection.imageCount) || 0
    );


  }

  const payload = buildPythonSuggestPayload({
    ...ctx,
    target: {
      ...ctx.target,
      photoCount: detectionImageCount,
    },
    category,
    businessEmail: ctx.businessEmail,
    detectedItems,
  });

  return {
    payload,
    ctx,
    category,
    detectedItems,
  };
}

async function suggestReplyForTargetMessage(adminId, threadId, messageId) {
  const { payload, ctx, category, detectedItems } =
    await buildSuggestReplyPythonPayloadForThread(adminId, threadId, messageId);

 

  const suggestion = await callPythonSuggestReply(payload, category, {
    from: payload.message.from,
    threadId: ctx.threadId,
    id: ctx.messageId,
  });

  const resolvedCategory = suggestion.category || category;

  // Quote items-only: do not attach reply-draft context / raw detections.
  if (resolvedCategory === 'quote') {
    return {
      ...suggestion,
      inReplyToMessageId: ctx.messageId,
    };
  }

  return {
    ...suggestion,
    inReplyToMessageId: ctx.messageId,
    suggestReplyContext: payload.thread,
    detectedItems,
  };
}

/** Uses messageId when provided; otherwise newest message in thread. */
async function suggestReplyForThread(adminId, threadId, messageId) {
  const targetMessageId =
    messageId || (await getLatestMessageIdInThread(adminId, threadId));
  return suggestReplyForTargetMessage(adminId, threadId, targetMessageId);
}

/** Suggest reply for a specific message + all prior messages in thread. */
async function suggestReplyForMessage(adminId, threadId, messageId) {
  if (!messageId) {
    const err = new Error('messageId is required');
    err.status = 400;
    throw err;
  }
  return suggestReplyForTargetMessage(adminId, threadId, messageId);
}

module.exports = {
  suggestReplyForThread,
  suggestReplyForMessage,
  buildSuggestReplyPythonPayloadForThread,
};
