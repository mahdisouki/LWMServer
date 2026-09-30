const ThreadQuoteItems = require('../models/ThreadQuoteItems');

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

/**
 * Keep existing rows; append only AI items that don't already match.
 */
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

function formatDoc(doc) {
  if (!doc) return null;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    threadId: plain.threadId,
    messageId: plain.messageId || null,
    items: Array.isArray(plain.items) ? plain.items : [],
    source: plain.source || 'suggest_reply',
    updatedAt: plain.updatedAt || null,
    createdAt: plain.createdAt || null,
  };
}

async function getQuoteItemsForThread(threadId) {
  const tid = String(threadId || '').trim();
  if (!tid) return null;
  const doc = await ThreadQuoteItems.findOne({ threadId: tid }).lean();
  return formatDoc(doc);
}

/**
 * After suggest-reply: create if missing; else merge only new items.
 * Returns the saved document (merged list).
 */
async function mergeSuggestReplyItems(threadId, messageId, incomingItems) {
  const tid = String(threadId || '').trim();
  if (!tid) {
    const err = new Error('threadId is required');
    err.status = 400;
    throw err;
  }

  const incoming = normalizeQuoteItems(incomingItems);
  const existing = await ThreadQuoteItems.findOne({ threadId: tid });

  if (!existing) {
    const created = await ThreadQuoteItems.create({
      threadId: tid,
      messageId: messageId || null,
      items: incoming,
      source: 'suggest_reply',
    });
    return formatDoc(created);
  }

  const merged = mergeNewQuoteItems(existing.items, incoming);
  existing.items = merged;
  if (messageId) existing.messageId = messageId;
  if (existing.source !== 'manual') existing.source = 'suggest_reply';
  await existing.save();
  return formatDoc(existing);
}

/** Explicit UI save — replace full list. */
async function saveQuoteItemsForThread(threadId, messageId, items) {
  const tid = String(threadId || '').trim();
  if (!tid) {
    const err = new Error('threadId is required');
    err.status = 400;
    throw err;
  }

  const normalized = normalizeQuoteItems(items);
  const doc = await ThreadQuoteItems.findOneAndUpdate(
    { threadId: tid },
    {
      threadId: tid,
      messageId: messageId || null,
      items: normalized,
      source: 'manual',
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return formatDoc(doc);
}

module.exports = {
  getQuoteItemsForThread,
  mergeSuggestReplyItems,
  saveQuoteItemsForThread,
  mergeNewQuoteItems,
  normalizeQuoteItems,
};
