const ThreadClassification = require('../models/ThreadClassification');

function optionalTrimmedString(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function optionalNumber(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeQuoteItem(item) {
  if (!item || typeof item !== 'object') return null;

  const itemName = optionalTrimmedString(item.item_name);
  const phrase = optionalTrimmedString(item.phrase) || itemName || '';
  const quantity =
    typeof item.quantity === 'number'
      ? item.quantity
      : Number(item.quantity) || 0;

  const normalized = {
    item_name: itemName || phrase || '',
    phrase,
    quantity,
    price:
      optionalNumber(item.price) ?? optionalNumber(item.final_price),
    final_price:
      optionalNumber(item.final_price) ?? optionalNumber(item.price),
    inside: optionalNumber(item.inside),
    inside_with_dismantling: optionalNumber(item.inside_with_dismantling),
    type: optionalTrimmedString(item.type),
    item_id: optionalTrimmedString(item.item_id),
    position: optionalTrimmedString(item.position),
    status: item.status != null ? String(item.status) : null,
  };

  if (!normalized.item_name && !normalized.phrase && !normalized.item_id) {
    return null;
  }

  return normalized;
}

function normalizeQuoteItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeQuoteItem).filter(Boolean);
}

function itemMatchKey(item) {
  const id = optionalTrimmedString(item?.item_id);
  if (id) return `id:${id.toLowerCase()}`;

  const name = (
    optionalTrimmedString(item?.item_name) ||
    optionalTrimmedString(item?.phrase) ||
    ''
  ).toLowerCase();
  const type = (optionalTrimmedString(item?.type) || '').toLowerCase();
  if (!name) return null;
  return `name:${name}|type:${type}`;
}

/** Keep existing rows; append only AI items that don't already match. */
function mergeNewQuoteItems(existingItems, incomingItems) {
  const existing = normalizeQuoteItems(existingItems);
  const incoming = normalizeQuoteItems(incomingItems);

  const seen = new Set();
  for (const item of existing) {
    const key = itemMatchKey(item);
    if (key) seen.add(key);
  }

  const merged = [...existing];
  for (const item of incoming) {
    const key = itemMatchKey(item);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(item);
  }

  return merged;
}

function formatQuoteItemsResult(doc) {
  if (!doc) {
    return {
      threadId: null,
      quoteItems: [],
      messageId: null,
      updatedAt: null,
    };
  }
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    threadId: plain.threadId,
    quoteItems: Array.isArray(plain.quoteItems) ? plain.quoteItems : [],
    messageId: plain.messageId || null,
    updatedAt: plain.updatedAt || null,
  };
}

async function getQuoteItemsForThread(threadId) {
  const tid = String(threadId || '').trim();
  if (!tid) return formatQuoteItemsResult(null);
  const doc = await ThreadClassification.findOne({ threadId: tid })
    .select('threadId messageId quoteItems updatedAt')
    .lean();
  if (!doc) return { ...formatQuoteItemsResult(null), threadId: tid };
  return formatQuoteItemsResult(doc);
}

/**
 * After suggest-reply: upsert classification quoteItems; merge only new items.
 */
async function mergeSuggestReplyItems(threadId, messageId, incomingItems) {
  const tid = String(threadId || '').trim();
  if (!tid) {
    const err = new Error('threadId is required');
    err.status = 400;
    throw err;
  }

  const incoming = normalizeQuoteItems(incomingItems);
  let doc = await ThreadClassification.findOne({ threadId: tid });

  if (!doc) {
    doc = await ThreadClassification.create({
      threadId: tid,
      messageId: messageId || null,
      quoteItems: incoming,
    });
    return formatQuoteItemsResult(doc);
  }

  doc.quoteItems = mergeNewQuoteItems(doc.quoteItems, incoming);
  if (messageId) doc.messageId = messageId;
  await doc.save();
  return formatQuoteItemsResult(doc);
}

/** Explicit UI save — replace quoteItems on the classification doc. */
async function saveQuoteItemsForThread(threadId, messageId, items) {
  const tid = String(threadId || '').trim();
  if (!tid) {
    const err = new Error('threadId is required');
    err.status = 400;
    throw err;
  }

  const normalized = normalizeQuoteItems(items);
  const update = { quoteItems: normalized };
  if (messageId) update.messageId = messageId;

  const doc = await ThreadClassification.findOneAndUpdate(
    { threadId: tid },
    {
      $set: update,
      $setOnInsert: { threadId: tid },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return formatQuoteItemsResult(doc);
}

module.exports = {
  getQuoteItemsForThread,
  mergeSuggestReplyItems,
  saveQuoteItemsForThread,
  mergeNewQuoteItems,
  normalizeQuoteItems,
};
