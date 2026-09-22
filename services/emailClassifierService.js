const axios = require('axios');
const ThreadClassification = require('../models/ThreadClassification');
const Admin = require('../models/Admin');
const { getCategoryLabel, GMAIL_AI_CATEGORIES } = require('../config/gmailCategories');
const { getGmailAuth } = require('./gmailAuthHelper');
const {
  getThreadClassifyPayload,
  getThreadListSnapshot,
  getThreadLatestListItem,
  getThreadMessageCount,
} = require('./gmailService');

const PYTHON_SERVER = (
  process.env.PYTHON_SERVER || 'http://localhost:8001'
).replace(/\/$/, '');

const CLASSIFIER_URL = `${PYTHON_SERVER}/tools/classify_email`;

const CLASSIFIER_TIMEOUT_MS = Number(process.env.EMAIL_CLASSIFIER_TIMEOUT_MS) || 30000;

function extractEmailAddress(fromHeader) {
  if (!fromHeader) return null;
  const m = String(fromHeader).match(/<([^>]+)>/);
  if (m) return m[1].trim();
  if (/@/.test(fromHeader)) return String(fromHeader).trim();
  return null;
}

function listSnapshotToMongoFields(snapshot) {
  if (!snapshot) return {};
  return {
    latestMessageId: snapshot.latestMessageId || null,
    snippet: snapshot.snippet || '',
    from: snapshot.from || '',
    to: snapshot.to || '',
    cc: snapshot.cc || '',
    subject: snapshot.subject || '',
    date: snapshot.date || '',
    internalDate: snapshot.internalDate || null,
    threadMessageCount: snapshot.threadMessageCount ?? 1,
    labelIds: Array.isArray(snapshot.labelIds) ? snapshot.labelIds : [],
  };
}

function docHasListSnapshot(doc) {
  return Boolean(doc?.latestMessageId && doc?.threadId);
}

function formatClassificationDoc(doc) {
  if (!doc) return null;
  const plain = doc.toObject ? doc.toObject() : doc;
  return {
    threadId: plain.threadId,
    messageId: plain.messageId || null,
    aiCategory: plain.aiCategory || null,
    aiCategoryLabel: getCategoryLabel(plain.aiCategory),
    confidence: plain.confidence ?? null,
    reason: plain.reason || null,
    status: plain.status || 'pending',
    classifiedAt: plain.classifiedAt || null,
  };
}

async function classifyEmailViaPython({
  subject,
  contentMain,
  snippet = null,
  from_address = null,
}) {
  const res = await axios.post(
    CLASSIFIER_URL,
    {
      subject: subject || '',
      contentMain: contentMain || '',
      snippet,
      from_address,
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: CLASSIFIER_TIMEOUT_MS,
    }
  );

  const data = res.data || {};
  return {
    category: data.category || null,
    confidence:
      typeof data.confidence === 'number' ? data.confidence : null,
    reason: data.reason || null,
  };
}

/** Update stored list snapshot for an already-classified thread. */
async function refreshThreadListSnapshot(adminId, threadId) {
  const snapshot = await getThreadListSnapshot(adminId, threadId);
  if (!snapshot) return null;

  const doc = await ThreadClassification.findOneAndUpdate(
    { threadId },
    listSnapshotToMongoFields(snapshot),
    { new: true }
  ).lean();

  return doc;
}

/**
 * Classify one thread (oldest message) and upsert Mongo. Skips if already done unless force.
 */
async function classifyAndStoreThread(adminId, threadId, options = {}) {
  const force = Boolean(options.force);
  const existing = await ThreadClassification.findOne({ threadId }).lean();

  if (
    !force &&
    existing?.status === 'done' &&
    existing.aiCategory
  ) {
    return formatClassificationDoc(existing);
  }

  const classifyPayload = await getThreadClassifyPayload(adminId, threadId);
  const listSnapshot =
    classifyPayload.listSnapshot ||
    (await getThreadListSnapshot(adminId, threadId));

  const from_address = extractEmailAddress(classifyPayload.from);

  let aiCategory = null;
  let confidence = null;
  let reason = null;
  let status = 'failed';

  try {
    const result = await classifyEmailViaPython({
      subject: classifyPayload.subject,
      contentMain: classifyPayload.contentMain,
      snippet: classifyPayload.snippet || null,
      from_address,
    });
    aiCategory = result.category;
    confidence = result.confidence;
    reason = result.reason;
    status = aiCategory ? 'done' : 'failed';
  } catch (err) {
    console.warn(
      `[emailClassifier] Python classify failed thread ${threadId}:`,
      err.message
    );
  }

  const doc = await ThreadClassification.findOneAndUpdate(
    { threadId },
    {
      threadId,
      messageId: classifyPayload.messageId,
      aiCategory,
      confidence,
      reason,
      status,
      classifiedAt: new Date(),
      ...listSnapshotToMongoFields(listSnapshot),
    },
    { upsert: true, new: true }
  );

  return formatClassificationDoc(doc);
}

async function getClassificationMapForThreads(_adminId, threadIds = []) {
  const ids = [...new Set(threadIds.filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;

  const docs = await ThreadClassification.find({
    threadId: { $in: ids },
  }).lean();

  for (const doc of docs) {
    map.set(doc.threadId, formatClassificationDoc(doc));
  }
  return map;
}

function applyAiCategoryFields(messages, classMap) {
  return messages.map((m) => {
    const c = classMap.get(m.threadId);
    return {
      ...m,
      aiCategory: c?.aiCategory ?? null,
      aiCategoryLabel: c?.aiCategoryLabel ?? null,
      aiClassificationStatus: c?.status ?? null,
      aiClassificationConfidence: c?.confidence ?? null,
    };
  });
}

function applyAiCategorySlugOnly(messages, classMap) {
  return messages.map((m) => ({
    ...m,
    aiCategory: classMap.get(m.threadId)?.aiCategory ?? null,
  }));
}

/** Thread message list: only aiCategory slug (no label/status/confidence). */
async function attachThreadAiCategorySlug(adminId, messages = []) {
  if (!messages.length) return messages;
  const threadIds = [...new Set(messages.map((m) => m.threadId).filter(Boolean))];
  const classMap = await getClassificationMapForThreads(adminId, threadIds);
  return applyAiCategorySlugOnly(messages, classMap);
}

/** Attach stored categories only (no Python calls). */
async function attachStoredAiCategories(adminId, messages = []) {
  if (!messages.length) return messages;
  const threadIds = [...new Set(messages.map((m) => m.threadId).filter(Boolean))];
  const classMap = await getClassificationMapForThreads(adminId, threadIds);
  return applyAiCategoryFields(messages, classMap);
}

/** New inbox: classify threads not yet stored, then attach fields. */
async function enrichNewMessagesWithAiCategory(adminId, messages = []) {
  if (!messages.length) return messages;

  const threadIds = [...new Set(messages.map((m) => m.threadId).filter(Boolean))];
  let classMap = await getClassificationMapForThreads(adminId, threadIds);

  for (const threadId of threadIds) {
    const existing = classMap.get(threadId);
    if (existing?.status === 'done' && existing.aiCategory) {
      try {
        await refreshThreadListSnapshot(adminId, threadId);
      } catch (err) {
        console.warn(
          `[emailClassifier] snapshot refresh failed thread ${threadId}:`,
          err.message
        );
      }
      continue;
    }

    try {
      const stored = await classifyAndStoreThread(adminId, threadId);
      classMap.set(threadId, stored);
    } catch (err) {
      console.warn(
        `[emailClassifier] skip thread ${threadId}:`,
        err.message
      );
    }
  }

  return applyAiCategoryFields(messages, classMap);
}

/** Any admin with Gmail connected — for legacy snapshot backfill only. */
async function resolveGmailAdminId(preferredAdminId) {
  if (preferredAdminId) {
    const preferred = await Admin.findById(preferredAdminId)
      .select('gmailTokens')
      .lean();
    if (preferred?.gmailTokens?.access_token) {
      return String(preferredAdminId);
    }
  }

  const fallback = await Admin.findOne({
    'gmailTokens.access_token': { $exists: true, $ne: null },
  })
    .select('_id')
    .lean();

  return fallback?._id ? String(fallback._id) : preferredAdminId || null;
}

/** Per-category thread + unread counts (global — all admins share classifications). */
async function listGmailCategories() {
  const grouped = await ThreadClassification.aggregate([
    {
      $match: {
        status: 'done',
        aiCategory: { $exists: true, $nin: [null, ''] },
      },
    },
    { $sort: { internalDate: -1, updatedAt: -1 } },
    {
      $group: {
        _id: '$threadId',
        aiCategory: { $first: '$aiCategory' },
        labelIds: { $first: '$labelIds' },
      },
    },
    {
      $group: {
        _id: '$aiCategory',
        threadCount: { $sum: 1 },
        unreadCount: {
          $sum: {
            $cond: [{ $in: ['UNREAD', { $ifNull: ['$labelIds', []] }] }, 1, 0],
          },
        },
      },
    },
  ]);

  const statsBySlug = new Map(
    grouped.map((row) => [
      String(row._id),
      {
        threadCount: row.threadCount,
        unreadCount: row.unreadCount || 0,
      },
    ])
  );

  const categories = GMAIL_AI_CATEGORIES.map((c) => {
    const stats = statsBySlug.get(c.slug);
    const threadCount = stats?.threadCount || 0;
    const unreadCount = stats?.unreadCount || 0;

    return {
      id: c.slug,
      slug: c.slug,
      label: c.label,
      order: c.order,
      count: threadCount,
      threadCount,
      messageCount: threadCount,
      unreadCount,
    };
  });

  const totalClassified = categories.reduce((sum, c) => sum + c.threadCount, 0);
  const totalUnreadClassified = categories.reduce(
    (sum, c) => sum + c.unreadCount,
    0
  );

  return { categories, totalClassified, totalUnreadClassified, allAdmins: true };
}

function filterMessagesByAiCategory(messages, aiCategory) {
  if (!aiCategory) return messages;
  const slug = String(aiCategory).trim().toLowerCase();
  return messages.filter((m) => (m.aiCategory || '').toLowerCase() === slug);
}

function messageMatchesLabelFilter(message, labelIds = [], includeSpamTrash = false) {
  const ids = message?.labelIds || [];
  if (!includeSpamTrash && (ids.includes('TRASH') || ids.includes('SPAM'))) {
    return false;
  }
  if (!labelIds.length) return true;
  return labelIds.every((label) => ids.includes(label));
}

function classificationToMessageFields(doc) {
  return {
    aiCategory: doc.aiCategory || null,
    aiCategoryLabel: getCategoryLabel(doc.aiCategory),
    aiClassificationStatus: doc.status || null,
    aiClassificationConfidence: doc.confidence ?? null,
  };
}

/** Slim row for GET /messages?aiCategory=… from stored Mongo snapshot. */
function formatAiCategoryListMessageFromDoc(doc) {
  return {
    id: doc.latestMessageId,
    threadId: doc.threadId,
    snippet: doc.snippet || '',
    labelIds: doc.labelIds || [],
    from: doc.from || '',
    to: doc.to || '',
    cc: doc.cc || '',
    subject: doc.subject || '',
    date: doc.date || '',
    aiCategory: doc.aiCategory || null,
    threadMessageCount: doc.threadMessageCount ?? 1,
  };
}

/** Legacy Gmail fallback for rows classified before snapshot fields existed. */
async function formatAiCategoryListMessageFromGmail(adminId, doc) {
  const listItem = await getThreadLatestListItem(adminId, doc.threadId);
  if (!listItem) return null;

  const threadMessageCount = await getThreadMessageCount(adminId, doc.threadId);
  const snapshot = {
    latestMessageId: listItem.id,
    threadId: listItem.threadId,
    snippet: listItem.snippet || '',
    labelIds: listItem.labelIds || [],
    from: listItem.from || '',
    to: listItem.to || '',
    cc: listItem.cc || '',
    subject: listItem.subject || '',
    date: listItem.date || '',
    internalDate: listItem.internalDate || null,
    threadMessageCount,
  };

  await ThreadClassification.updateOne(
    { threadId: doc.threadId },
    listSnapshotToMongoFields(snapshot)
  );

  return formatAiCategoryListMessageFromDoc({
    ...doc,
    ...snapshot,
    aiCategory: doc.aiCategory,
  });
}

/**
 * List messages for an AI category from Mongo snapshots (global, all admins).
 * pageToken is a numeric offset into classified threads (not a Gmail token).
 */
async function listMessagesByAiCategory(options = {}) {
  const slug = String(options.aiCategory || '').trim().toLowerCase();
  if (!slug) {
    return { messages: [], nextPageToken: null, resultSizeEstimate: 0, allAdmins: true };
  }

  const gmailAdminId = await resolveGmailAdminId(options.gmailAdminId);

  const limit = Math.min(Math.max(Number(options.maxResults) || 20, 1), 50);
  const offset = Math.max(0, parseInt(String(options.pageToken || ''), 10) || 0);
  const labelIds = Array.isArray(options.labelIds) ? options.labelIds : [];
  const includeSpamTrash = Boolean(options.includeSpamTrash);

  const filter = {
    aiCategory: slug,
    status: 'done',
  };

  const total = await ThreadClassification.countDocuments(filter);
  if (total === 0 || offset >= total) {
    return { messages: [], nextPageToken: null, resultSizeEstimate: total };
  }

  const messages = [];
  const seenThreadIds = new Set();
  let cursor = offset;
  const batchSize = Math.max(limit, 10);

  while (messages.length < limit && cursor < total) {
    const docs = await ThreadClassification.find(filter)
      .sort({ internalDate: -1, classifiedAt: -1, updatedAt: -1 })
      .skip(cursor)
      .limit(batchSize)
      .lean();

    if (!docs.length) break;

    for (const doc of docs) {
      if (seenThreadIds.has(doc.threadId)) continue;

      let row;
      if (docHasListSnapshot(doc)) {
        row = formatAiCategoryListMessageFromDoc(doc);
      } else if (gmailAdminId) {
        row = await formatAiCategoryListMessageFromGmail(gmailAdminId, doc);
      } else {
        row = formatAiCategoryListMessageFromDoc(doc);
      }

      if (!row) continue;
      if (!messageMatchesLabelFilter(row, labelIds, includeSpamTrash)) {
        continue;
      }

      seenThreadIds.add(doc.threadId);
      messages.push(row);
      if (messages.length >= limit) break;
    }

    cursor += docs.length;
  }

  const nextPageToken = cursor < total ? String(cursor) : null;

  return {
    messages,
    nextPageToken,
    resultSizeEstimate: total,
    allAdmins: true,
  };
}

module.exports = {
  classifyEmailViaPython,
  classifyAndStoreThread,
  refreshThreadListSnapshot,
  getClassificationMapForThreads,
  attachStoredAiCategories,
  attachThreadAiCategorySlug,
  enrichNewMessagesWithAiCategory,
  listGmailCategories,
  listMessagesByAiCategory,
  filterMessagesByAiCategory,
  getCategoryLabel,
};
