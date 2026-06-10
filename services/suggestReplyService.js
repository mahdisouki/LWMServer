const axios = require('axios');
const ThreadClassification = require('../models/ThreadClassification');
const {
  getSuggestReplyThreadContext,
  getLatestMessageIdInThread,
} = require('./gmailService');

const SUGGEST_REPLY_URL =
  process.env.SUGGEST_REPLY_URL ||
  'http://localhost:8001/suggest_reply';

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
  console.log('[Suggest Reply] Payload:', JSON.stringify(pythonPayload, null, 2));

  const res = await axios.post(SUGGEST_REPLY_URL, pythonPayload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: SUGGEST_REPLY_TIMEOUT_MS,
  });

  const data = res.data || {};
  const suggestedReplies = Array.isArray(data.suggested_replies)
    ? data.suggested_replies.filter((x) => typeof x === 'string' && x.trim())
    : [];

  return {
    category: data.category ?? fallbackCategory,
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
    threadId: data.threadId || pythonPayload.message?.threadId,
    messageId: data.messageId || pythonPayload.message?.messageId,
    from: messageContext?.from || null,
  };
}

async function getCategoryForThread(adminId, threadId) {
  const classification = await ThreadClassification.findOne({
    adminId,
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

function buildThreadHistoryForPython(threadHistory) {
  return threadHistory.map((row) => ({
    direction: row.direction,
    from: formatFromForSuggestReply(
      row.fromHeader,
      row.from_address,
      row.direction
    ),
    subject: row.subject || '',
    contentMain: buildContentMainForSuggest(
      row.contentMain,
      row.photoCount
    ),
    sent_at: row.internalDate || null,
  }));
}

function buildPythonSuggestPayload({
  threadId,
  messageId,
  target,
  threadHistory,
  category,
  businessEmail,
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
    thread: buildThreadHistoryForPython(threadHistory),
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

async function suggestReplyForTargetMessage(adminId, threadId, messageId) {
  const ctx = await getSuggestReplyThreadContext(adminId, threadId, messageId);
  const category = await getCategoryForThread(adminId, ctx.threadId);
  const payload = buildPythonSuggestPayload({
    ...ctx,
    category,
    businessEmail: ctx.businessEmail,
  });

  console.log(
    `[Suggest Reply] threadId=${ctx.threadId} targetMessageId=${ctx.messageId} threadCount=${ctx.threadHistory.length}`
  );

  return callPythonSuggestReply(payload, category, {
    from: payload.message.from,
    threadId: ctx.threadId,
    id: ctx.messageId,
  });
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
};
