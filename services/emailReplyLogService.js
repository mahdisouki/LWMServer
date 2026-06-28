const EmailReplyLog = require('../models/EmailReplyLog');

const REPLY_SOURCES = ['admin', 'ai', 'ai_edited'];

function parseJsonField(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseStringArrayField(value) {
  const parsed = parseJsonField(value);
  if (Array.isArray(parsed)) {
    return parsed.filter((x) => typeof x === 'string' && x.trim());
  }
  if (Array.isArray(value)) {
    return value.filter((x) => typeof x === 'string' && x.trim());
  }
  return [];
}

function normalizeReplySource(value) {
  const source = String(value || 'admin')
    .trim()
    .toLowerCase();
  return REPLY_SOURCES.includes(source) ? source : 'admin';
}

function normalizeSuggestReplyContext(value) {
  const ctx = parseJsonField(value);
  if (!ctx || typeof ctx !== 'object') return null;

  const message =
    ctx.message && typeof ctx.message === 'object' ? ctx.message : null;
  const thread = Array.isArray(ctx.thread) ? ctx.thread : [];

  if (!message && thread.length === 0) return null;

  return { message, thread };
}

async function createReplyLog({
  adminId,
  threadId,
  messageId,
  inReplyToMessageId,
  replySource,
  suggestedReplies,
  suggestReplyContext,
  subject,
  to,
  sentAt,
}) {
  return EmailReplyLog.create({
    adminId,
    threadId,
    messageId,
    inReplyToMessageId,
    replySource: normalizeReplySource(replySource),
    suggestedReplies: parseStringArrayField(suggestedReplies),
    suggestReplyContext: normalizeSuggestReplyContext(suggestReplyContext),
    subject: String(subject || ''),
    to: String(to || ''),
    sentAt: sentAt || new Date(),
  });
}

function buildListFilter(adminId, query = {}) {
  const filter = { adminId };

  if (query.threadId) {
    filter.threadId = String(query.threadId).trim();
  }

  if (query.replySource) {
    const source = String(query.replySource).trim().toLowerCase();
    if (REPLY_SOURCES.includes(source)) {
      filter.replySource = source;
    }
  }

  if (query.from || query.to) {
    filter.sentAt = {};
    if (query.from) {
      const from = new Date(query.from);
      if (!isNaN(from.getTime())) filter.sentAt.$gte = from;
    }
    if (query.to) {
      const to = new Date(query.to);
      if (!isNaN(to.getTime())) filter.sentAt.$lte = to;
    }
    if (Object.keys(filter.sentAt).length === 0) delete filter.sentAt;
  }

  return filter;
}

async function listReplyLogs(adminId, query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const skip = (page - 1) * limit;
  const filter = buildListFilter(adminId, query);

  const [items, total] = await Promise.all([
    EmailReplyLog.find(filter)
      .sort({ sentAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    EmailReplyLog.countDocuments(filter),
  ]);

  return { items, total, page, limit };
}

async function listThreadReplyLogs(adminId, threadId, query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const skip = (page - 1) * limit;
  const filter = { adminId, threadId: String(threadId).trim() };

  if (query.replySource) {
    const source = String(query.replySource).trim().toLowerCase();
    if (REPLY_SOURCES.includes(source)) {
      filter.replySource = source;
    }
  }

  const [items, total] = await Promise.all([
    EmailReplyLog.find(filter)
      .sort({ sentAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    EmailReplyLog.countDocuments(filter),
  ]);

  return { items, total, page, limit };
}

async function getReplyStats(adminId, query = {}) {
  const filter = buildListFilter(adminId, query);

  const rows = await EmailReplyLog.aggregate([
    { $match: filter },
    { $group: { _id: '$replySource', count: { $sum: 1 } } },
  ]);

  const stats = { admin: 0, ai: 0, ai_edited: 0, total: 0 };
  for (const row of rows) {
    if (stats[row._id] != null) {
      stats[row._id] = row.count;
      stats.total += row.count;
    }
  }

  return stats;
}

module.exports = {
  REPLY_SOURCES,
  parseJsonField,
  parseStringArrayField,
  normalizeReplySource,
  normalizeSuggestReplyContext,
  createReplyLog,
  listReplyLogs,
  listThreadReplyLogs,
  getReplyStats,
};
