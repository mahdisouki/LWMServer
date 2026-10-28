const axios = require('axios');
const {
  getLatestMessageIdInThread,
  collectOrderAttachmentsFromMessages,
  getMessageMainHtml,
} = require('./gmailService');
const { buildSuggestReplyPythonPayloadForThread } = require('./suggestReplyService');
const {
  extractUploadedItemImageUrlsFromHtml,
} = require('./detectionAiService');

const PYTHON_SERVER = (
  process.env.PYTHON_SERVER || 'http://localhost:8001'
).replace(/\/$/, '');

const LLM_ORDER_URL = `${PYTHON_SERVER}/order_llm`;

const LLM_ORDER_TIMEOUT_MS =
  Number(process.env.LLM_ORDER_TIMEOUT_MS) || 60000;

function filenameFromImageUrl(url) {
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').filter(Boolean).pop() || 'image.jpg';
    return decodeURIComponent(last);
  } catch {
    return 'image.jpg';
  }
}

/**
 * Quotation "Item N - View Image" Cloudinary (etc.) links from message HTML.
 */
function collectViewImageAttachmentsFromMessages(messages = []) {
  const seen = new Set();
  const attachments = [];

  for (const msg of messages) {
    const html = getMessageMainHtml(msg);
    const urls = extractUploadedItemImageUrlsFromHtml(html);
    for (const url of urls) {
      const key = String(url).trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      attachments.push({
        messageId: msg.id || null,
        attachmentId: null,
        filename: filenameFromImageUrl(url),
        mimeType: 'image/jpeg',
        size: null,
        attachmentRole: 'view_image',
        downloadUrl: url,
        url,
      });
    }
  }

  return attachments;
}

/** Gmail MIME attachments + quotation View Image Cloudinary URLs (deduped). */
function collectAllOrderAttachments(messages = []) {
  const mime = collectOrderAttachmentsFromMessages(messages);
  const viewImages = collectViewImageAttachmentsFromMessages(messages);

  const seen = new Set();
  const merged = [];

  for (const att of [...mime, ...viewImages]) {
    const key = String(att.downloadUrl || att.url || '')
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(att);
  }

  return merged;
}

function optionalTrimmedString(value) {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s ? s : undefined;
}

function optionalNumber(value) {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Map frontend / client items into the /order_llm items shape. */
function normalizeItemsForPython(items) {
  if (!Array.isArray(items)) return [];

  return items.map((item) => {
    const itemName = optionalTrimmedString(item?.item_name);
    const phrase =
      optionalTrimmedString(item?.phrase) || itemName || '';
    const quantity =
      typeof item?.quantity === 'number'
        ? item.quantity
        : Number(item?.quantity) || 0;

    const normalized = {
      phrase,
      quantity,
    };

    const type = optionalTrimmedString(item?.type);
    if (type) normalized.type = type;

    const itemId = optionalTrimmedString(item?.item_id);
    if (itemId) normalized.item_id = itemId;

    if (itemName) normalized.item_name = itemName;

    const finalPrice =
      optionalNumber(item?.final_price) ?? optionalNumber(item?.price);
    if (finalPrice != null) normalized.final_price = finalPrice;

    const position = optionalTrimmedString(item?.position);
    if (position) normalized.position = position;

    const inside = optionalNumber(item?.inside);
    if (inside != null) normalized.inside = inside;

    const insideWithDismantling = optionalNumber(
      item?.inside_with_dismantling
    );
    if (insideWithDismantling != null) {
      normalized.inside_with_dismantling = insideWithDismantling;
    }

    if (item?.status != null) normalized.status = item.status;

    return normalized;
  });
}

function normalizeLlmOrderItem(item) {
  const itemName = optionalTrimmedString(item?.item_name);
  const phrase =
    optionalTrimmedString(item?.phrase) || itemName || '';
  const quantity =
    typeof item?.quantity === 'number'
      ? item.quantity
      : Number(item?.quantity) || 0;

  const normalized = {
    phrase,
    quantity,
    status: item?.status ?? null,
  };

  const itemId = optionalTrimmedString(item?.item_id);
  if (itemId) normalized.item_id = itemId;

  if (itemName) normalized.item_name = itemName;

  const type = optionalTrimmedString(item?.type);
  if (type) normalized.type = type;

  const finalPrice =
    optionalNumber(item?.final_price) ?? optionalNumber(item?.price);
  if (finalPrice != null) {
    normalized.final_price = finalPrice;
    normalized.price = finalPrice;
  }

  const position = optionalTrimmedString(item?.position);
  if (position) normalized.position = position;

  const inside = optionalNumber(item?.inside);
  if (inside != null) normalized.inside = inside;

  const insideWithDismantling = optionalNumber(
    item?.inside_with_dismantling
  );
  if (insideWithDismantling != null) {
    normalized.inside_with_dismantling = insideWithDismantling;
  }

  return normalized;
}

function normalizeLlmOrderResponse(data, pythonPayload, ctx, attachments) {
  const customer =
    data?.customer && typeof data.customer === 'object' ? data.customer : {};

  const rawItems = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(pythonPayload?.items)
      ? pythonPayload.items
      : [];

  const items = rawItems.map(normalizeLlmOrderItem);

  const order = {
    customer: {
      firstName: customer.firstName ?? null,
      lastName: customer.lastName ?? null,
      phoneNumber: customer.phoneNumber ?? null,
      email: customer.email ?? null,
      postcode: customer.postcode ?? null,
      address: customer.address ?? null,
    },
    items,
    bookingDate: data?.bookingDate ?? null,
    bookingTimeSlot: data?.bookingTimeSlot ?? null,
    customerNote: data?.customerNote ?? null,
    attachments,
    source: data?.source ?? null,
    llm_error: data?.llm_error ?? null,
    subject: data?.subject || pythonPayload.message?.subject || '',
    threadId:
      data?.threadId ||
      pythonPayload.threadId ||
      pythonPayload.message?.threadId ||
      ctx.threadId,
    messageId:
      data?.messageId ||
      pythonPayload.messageId ||
      pythonPayload.message?.messageId ||
      ctx.messageId,
  };

  const warning =
    data?.warning != null && String(data.warning).trim()
      ? String(data.warning).trim()
      : null;
  if (warning) {
    order.warning = warning;
  }

  return order;
}

function buildPythonLlmOrderPayload(suggestPayload, ctx, items) {
  return {
    message: suggestPayload.message,
    thread: suggestPayload.thread,
    threadId: ctx.threadId,
    messageId: ctx.messageId,
    items: normalizeItemsForPython(items),
  };
}

async function callPythonLlmOrder(pythonPayload, ctx, attachments) {
  const res = await axios.post(LLM_ORDER_URL, pythonPayload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: LLM_ORDER_TIMEOUT_MS,
  });

  console.log(
    '[LLM Order] Python engine raw response:',
    JSON.stringify(res.data, null, 2)
  );

  const order = normalizeLlmOrderResponse(
    res.data,
    pythonPayload,
    ctx,
    attachments
  );

  console.log(
    '[LLM Order] Create order response (normalized):',
    JSON.stringify(order, null, 2)
  );

  return order;
}

async function llmOrderForTargetMessage(adminId, threadId, messageId, items = []) {
  const { payload, ctx } = await buildSuggestReplyPythonPayloadForThread(
    adminId,
    threadId,
    messageId
  );

  const attachments = collectAllOrderAttachments(
    ctx.messagesThroughTarget || []
  );

  const pythonPayload = buildPythonLlmOrderPayload(payload, ctx, items);

  console.log(
    `[LLM Order] threadId=${ctx.threadId} targetMessageId=${ctx.messageId} threadCount=${ctx.threadHistory.length} items=${pythonPayload.items.length} attachments=${attachments.length}`
  );

  return callPythonLlmOrder(pythonPayload, ctx, attachments);
}

/** Uses messageId when provided; otherwise newest message in thread. */
async function llmOrderForThread(adminId, threadId, messageId, items = []) {
  const targetMessageId =
    messageId || (await getLatestMessageIdInThread(adminId, threadId));
  return llmOrderForTargetMessage(adminId, threadId, targetMessageId, items);
}

module.exports = {
  llmOrderForThread,
  llmOrderForTargetMessage,
  normalizeItemsForPython,
};
