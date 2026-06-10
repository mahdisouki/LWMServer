const axios = require('axios');
const mongoose = require('mongoose');
const ThreadClassification = require('../models/ThreadClassification');
const { getCategoryLabel, GMAIL_AI_CATEGORIES } = require('../config/gmailCategories');
const { getGmailAuth } = require('./gmailAuthHelper');
const {
  getThreadClassifyPayload,
  getThreadLatestListItem,
  getThreadMessageCount,
  mapWithConcurrency,
} = require('./gmailService');

const CLASSIFIER_URL =
  process.env.EMAIL_CLASSIFIER_URL ||
  'http://localhost:8001/tools/classify_email';

const CLASSIFIER_TIMEOUT_MS = Number(process.env.EMAIL_CLASSIFIER_TIMEOUT_MS) || 30000;

function extractEmailAddress(fromHeader) {
  if (!fromHeader) return null;
  const m = String(fromHeader).match(/<([^>]+)>/);
  if (m) return m[1].trim();
  if (/@/.test(fromHeader)) return String(fromHeader).trim();
  return null;
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

/**
 * Classify one thread (oldest message) and upsert Mongo. Skips if already done unless force.
 */
async function classifyAndStoreThread(adminId, threadId, options = {}) {
  const force = Boolean(options.force);
  const existing = await ThreadClassification.findOne({ adminId, threadId }).lean();

  if (
    !force &&
    existing?.status === 'done' &&
    existing.aiCategory
  ) {
    return formatClassificationDoc(existing);
  }

  const payload = await getThreadClassifyPayload(adminId, threadId);

  const from_address = extractEmailAddress(payload.from);

  let aiCategory = null;
  let confidence = null;
  let reason = null;
  let status = 'failed';

  try {
    const result = await classifyEmailViaPython({
      subject: payload.subject,
      contentMain: payload.contentMain,
      snippet: payload.snippet || null,
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
    { adminId, threadId },
    {
      adminId,
      threadId,
      messageId: payload.messageId,
      aiCategory,
      confidence,
      reason,
      status,
      classifiedAt: new Date(),
    },
    { upsert: true, new: true }
  );

  return formatClassificationDoc(doc);
}

async function getClassificationMapForThreads(adminId, threadIds = []) {
  const ids = [...new Set(threadIds.filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;

  const docs = await ThreadClassification.find({
    adminId,
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
    if (existing?.status === 'done' && existing.aiCategory) continue;

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

/** All Gmail thread IDs that currently have unread mail. */
async function fetchUnreadThreadIdSet(adminId) {
  let gmail;
  try {
    gmail = await getGmailAuth(adminId);
  } catch {
    return new Set();
  }

  const ids = new Set();
  let pageToken;
  let pages = 0;
  const maxPages = 20;

  do {
    const res = await gmail.users.threads.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: 500,
      pageToken,
    });
    for (const t of res.data.threads || []) {
      if (t.id) ids.add(t.id);
    }
    pageToken = res.data.nextPageToken;
    pages += 1;
  } while (pageToken && pages < maxPages);

  return ids;
}

/** Per-category thread + unread counts (unread = classified thread still unread in Gmail). */
async function listGmailCategories(adminId) {
  const adminObjectId = new mongoose.Types.ObjectId(adminId);

  const [grouped, unreadThreadIds] = await Promise.all([
    ThreadClassification.aggregate([
      {
        $match: {
          adminId: adminObjectId,
          status: 'done',
          aiCategory: { $exists: true, $nin: [null, ''] },
        },
      },
      {
        $group: {
          _id: '$aiCategory',
          threadCount: { $sum: 1 },
          threadIds: { $addToSet: '$threadId' },
        },
      },
    ]),
    fetchUnreadThreadIdSet(adminId),
  ]);

  const statsBySlug = new Map(
    grouped.map((row) => [
      String(row._id),
      {
        threadCount: row.threadCount,
        threadIds: row.threadIds || [],
      },
    ])
  );

  const categories = GMAIL_AI_CATEGORIES.map((c) => {
    const stats = statsBySlug.get(c.slug);
    const threadIds = stats?.threadIds || [];
    const threadCount = stats?.threadCount || 0;
    const unreadCount = threadIds.filter((id) => unreadThreadIds.has(id)).length;

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

  return { categories, totalClassified, totalUnreadClassified };
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
  };z
}

/** Slim row for GET /messages?aiCategory=… (no label/status/confidence/internalDate). */
function formatAiCategoryListMessage(listItem, classificationDoc, threadMessageCount) {
  return {
    id: listItem.id,
    threadId: listItem.threadId,
    snippet: listItem.snippet || '',
    labelIds: listItem.labelIds || [],
    from: listItem.from || '',
    to: listItem.to || '',
    cc: listItem.cc || '',
    subject: listItem.subject || '',
    date: listItem.date || '',
    aiCategory: classificationDoc?.aiCategory || null,
    threadMessageCount,
  };
}

/**
 * List messages for an AI category: Mongo threadclassifications first, then Gmail latest per thread.
 * pageToken is a numeric offset into classified threads (not a Gmail token).
 */
async function listMessagesByAiCategory(adminId, options = {}) {
  const slug = String(options.aiCategory || '').trim().toLowerCase();
  if (!slug) {
    return { messages: [], nextPageToken: null, resultSizeEstimate: 0 };
  }

  const limit = Math.min(Math.max(Number(options.maxResults) || 20, 1), 50);
  const offset = Math.max(0, parseInt(String(options.pageToken || ''), 10) || 0);
  const labelIds = Array.isArray(options.labelIds) ? options.labelIds : [];
  const includeSpamTrash = Boolean(options.includeSpamTrash);

  const filter = {
    adminId,
    aiCategory: slug,
    status: 'done',
  };

  const total = await ThreadClassification.countDocuments(filter);
  if (total === 0 || offset >= total) {
    return { messages: [], nextPageToken: null, resultSizeEstimate: total };
  }

  const messages = [];
  let cursor = offset;
  const batchSize = Math.max(limit, 10);

  while (messages.length < limit && cursor < total) {
    const docs = await ThreadClassification.find(filter)
      .sort({ classifiedAt: -1, updatedAt: -1 })
      .skip(cursor)
      .limit(batchSize)
      .lean();

    if (!docs.length) break;

    const rows = await mapWithConcurrency(docs, 6, async (doc) => {
      const listItem = await getThreadLatestListItem(adminId, doc.threadId);
      if (!listItem) return null;
      if (!messageMatchesLabelFilter(listItem, labelIds, includeSpamTrash)) {
        return null;
      }

      const threadMessageCount = await getThreadMessageCount(adminId, doc.threadId);
      return formatAiCategoryListMessage(listItem, doc, threadMessageCount);
    });

    for (const row of rows) {
      if (!row) continue;
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
  };
}

module.exports = {
  classifyEmailViaPython,
  classifyAndStoreThread,
  getClassificationMapForThreads,
  attachStoredAiCategories,
  attachThreadAiCategorySlug,
  enrichNewMessagesWithAiCategory,
  listGmailCategories,
  listMessagesByAiCategory,
  filterMessagesByAiCategory,
  getCategoryLabel,
};
