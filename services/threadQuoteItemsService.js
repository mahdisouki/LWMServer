const ThreadClassification = require('../models/ThreadClassification');
const StandardItem = require('../models/StandardItem');

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

function resolveSource(item) {
  if (item?.source === 'detection_ai') return 'detection_ai';
  if (item?.source === 'standard' || item?.source === 'custom') return 'python';
  if (item?.source === 'python') return 'python';
  return 'python';
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLookupName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/matress/g, 'mattress')
    .replace(/\s+/g, ' ');
}

/** Copy pricing from python/catalogue onto detection when missing. */
function mergePricingOntoDetection(detection, from) {
  if (!detection || !from) return detection;
  const merged = {
    ...detection,
    quantity: Number(detection.quantity) || Number(from.quantity) || 1,
    type: optionalTrimmedString(detection.type) || optionalTrimmedString(from.type),
  };
  const price = optionalNumber(detection.price) ?? optionalNumber(from.price);
  const finalPrice =
    optionalNumber(detection.final_price) ??
    optionalNumber(from.final_price) ??
    optionalNumber(from.price);
  const inside = optionalNumber(detection.inside) ?? optionalNumber(from.inside);
  const insideWith =
    optionalNumber(detection.inside_with_dismantling) ??
    optionalNumber(from.inside_with_dismantling);

  if (price != null) merged.price = price;
  else delete merged.price;
  if (finalPrice != null) merged.final_price = finalPrice;
  else delete merged.final_price;
  if (inside != null) merged.inside = inside;
  else delete merged.inside;
  if (insideWith != null) merged.inside_with_dismantling = insideWith;
  else delete merged.inside_with_dismantling;
  if (!merged.type) delete merged.type;

  return slimDetectionItem(merged);
}

/** Detection rows only keep useful fields (no status/position/item_id/nulls). */
function slimDetectionItem(item) {
  const out = {
    item_name: item.item_name,
    phrase: item.phrase || item.item_name,
    quantity: Number(item.quantity) || 1,
    source: 'detection_ai',
    type: 'standard',
    imageUrl: item.imageUrl || null,
  };
  if (optionalNumber(item.price) != null) out.price = optionalNumber(item.price);
  if (optionalNumber(item.final_price) != null) {
    out.final_price = optionalNumber(item.final_price);
  } else if (out.price != null) {
    out.final_price = out.price;
  }
  if (optionalNumber(item.inside) != null) out.inside = optionalNumber(item.inside);
  if (optionalNumber(item.inside_with_dismantling) != null) {
    out.inside_with_dismantling = optionalNumber(item.inside_with_dismantling);
  }
  return out;
}

function normalizeQuoteItem(item) {
  if (!item || typeof item !== 'object') return null;

  const itemName = optionalTrimmedString(item.item_name);
  const phrase = optionalTrimmedString(item.phrase) || itemName || '';
  const quantity =
    typeof item.quantity === 'number'
      ? item.quantity
      : Number(item.quantity) || 0;

  const legacyType =
    item.source === 'standard' || item.source === 'custom'
      ? item.source
      : null;

  const source = resolveSource(item);

  if (!itemName && !phrase) return null;

  if (source === 'detection_ai') {
    return slimDetectionItem({
      item_name: itemName || phrase,
      phrase,
      quantity,
      price: item.price,
      final_price: item.final_price,
      inside: item.inside,
      inside_with_dismantling: item.inside_with_dismantling,
      type: optionalTrimmedString(item.type) || legacyType,
      imageUrl: item.imageUrl,
    });
  }

  return {
    item_name: itemName || phrase || '',
    phrase,
    quantity,
    price:
      optionalNumber(item.price) ?? optionalNumber(item.final_price),
    final_price:
      optionalNumber(item.final_price) ?? optionalNumber(item.price),
    inside: optionalNumber(item.inside),
    inside_with_dismantling: optionalNumber(item.inside_with_dismantling),
    type: optionalTrimmedString(item.type) || legacyType,
    source: 'python',
    imageUrl: null,
  };
}

/** Unique by item name (case-insensitive). Detection wins over python. */
function itemMatchKey(item) {
  const name = (
    optionalTrimmedString(item?.item_name) ||
    optionalTrimmedString(item?.phrase) ||
    ''
  ).toLowerCase();
  if (!name) return null;
  return `name:${name}`;
}

/**
 * Collapse into a set by name.
 * Same name → keep detection_ai (with imageUrl) and take price fields from python.
 */
function dedupeQuoteItems(items) {
  if (!Array.isArray(items)) return [];
  const byKey = new Map();

  for (const raw of items) {
    const item = normalizeQuoteItem(raw);
    if (!item) continue;
    const key = itemMatchKey(item);
    if (!key) continue;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }

    if (item.source === 'detection_ai') {
      if (existing.source !== 'detection_ai') {
        byKey.set(key, mergePricingOntoDetection(item, existing));
        continue;
      }
      existing.quantity =
        (Number(existing.quantity) || 0) + (Number(item.quantity) || 0);
      if (!existing.imageUrl && item.imageUrl) {
        existing.imageUrl = item.imageUrl;
      }
      continue;
    }

    if (existing.source === 'detection_ai') {
      byKey.set(key, mergePricingOntoDetection(existing, item));
      continue;
    }
  }

  return [...byKey.values()];
}

function normalizeQuoteItems(items) {
  if (!Array.isArray(items)) return [];
  return dedupeQuoteItems(items);
}

/**
 * Fill missing detection prices from StandardItem catalogue (name match).
 */
async function enrichDetectionPricesFromCatalogue(items) {
  if (!Array.isArray(items) || !items.length) return items;

  const needsPrice = items.filter(
    (item) =>
      item?.source === 'detection_ai' && optionalNumber(item.price) == null
  );
  if (!needsPrice.length) return items.map(formatItemForClient);

  const names = [
    ...new Set(
      needsPrice
        .map((item) => optionalTrimmedString(item.item_name) || item.phrase)
        .filter(Boolean)
    ),
  ];

  const orClauses = [];
  for (const name of names) {
    const fixed = normalizeLookupName(name);
    orClauses.push({ itemName: new RegExp(`^${escapeRegex(name)}$`, 'i') });
    if (fixed !== name.toLowerCase()) {
      orClauses.push({
        itemName: new RegExp(`^${escapeRegex(fixed)}$`, 'i'),
      });
    }
  }

  const byNormalizedName = new Map();
  if (orClauses.length) {
    const catalogue = await StandardItem.find({
      isHidden: { $ne: true },
      $or: orClauses,
    })
      .select('itemName price insidePrice insideWithDismantlingPrice')
      .lean();

    for (const row of catalogue) {
      byNormalizedName.set(normalizeLookupName(row.itemName), row);
    }
  }

  return items.map((item) => {
    if (item?.source !== 'detection_ai') return formatItemForClient(item);
    if (optionalNumber(item.price) != null) return slimDetectionItem(item);

    const hit = byNormalizedName.get(normalizeLookupName(item.item_name));
    if (!hit) return slimDetectionItem(item);

    return slimDetectionItem({
      ...item,
      price: hit.price,
      final_price: hit.price,
      inside: hit.insidePrice,
      inside_with_dismantling: hit.insideWithDismantlingPrice,
      type: 'standard',
    });
  });
}

function formatItemForClient(item) {
  if (!item || typeof item !== 'object') return item;
  const source = resolveSource(item);
  if (source === 'detection_ai') {
    return slimDetectionItem({ ...item, source: 'detection_ai' });
  }
  const typeFromLegacySource =
    item.source === 'standard' || item.source === 'custom'
      ? item.source
      : null;
  return {
    item_name: item.item_name,
    phrase: item.phrase,
    quantity: item.quantity,
    price: item.price ?? null,
    final_price: item.final_price ?? null,
    inside: item.inside ?? null,
    inside_with_dismantling: item.inside_with_dismantling ?? null,
    type: item.type || typeFromLegacySource || null,
    source: 'python',
    imageUrl: null,
  };
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
  const quoteItems = Array.isArray(plain.quoteItems) ? plain.quoteItems : [];
  return {
    threadId: plain.threadId,
    quoteItems: quoteItems.map(formatItemForClient),
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

  let incoming = normalizeQuoteItems(incomingItems);
  incoming = await enrichDetectionPricesFromCatalogue(incoming);

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
  // Re-enrich after merge in case existing rows still need catalogue prices.
  doc.quoteItems = await enrichDetectionPricesFromCatalogue(doc.quoteItems);
  if (messageId) doc.messageId = messageId;
  await doc.save();
  return formatQuoteItemsResult(doc);
}

function mergeNewQuoteItems(existingItems, incomingItems) {
  return normalizeQuoteItems([
    ...(Array.isArray(existingItems) ? existingItems : []),
    ...(Array.isArray(incomingItems) ? incomingItems : []),
  ]);
}

/** Explicit UI save — replace quoteItems on the classification doc. */
async function saveQuoteItemsForThread(threadId, messageId, items) {
  const tid = String(threadId || '').trim();
  if (!tid) {
    const err = new Error('threadId is required');
    err.status = 400;
    throw err;
  }

  let normalized = normalizeQuoteItems(items);
  normalized = await enrichDetectionPricesFromCatalogue(normalized);
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
  dedupeQuoteItems,
  formatItemForClient,
  enrichDetectionPricesFromCatalogue,
};
