const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const EmailThreadAssignment = require('../models/EmailThreadAssignment');
const EmailContactOwner = require('../models/EmailContactOwner');

const ADMIN_SELECT = '_id username firstName lastName email picture';

function extractEmailAddress(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const angle = raw.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return '';
  return candidate;
}

function pickRandom(items) {
  if (!items?.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function getSocketHelpers() {
  return require('../socket');
}

function resolveGmailThreadId(message) {
  const tid = String(message?.threadId || '').trim();
  return tid || null;
}

async function getActiveAdminIds() {
  const admins = await Admin.find({ inboxAssignmentActive: true })
    .select('_id')
    .lean();
  return admins.map((a) => String(a._id));
}

/** @deprecated Use getActiveAdminIds — assignment no longer uses socket presence. */
async function getOnlineAdminIds() {
  return getActiveAdminIds();
}

/**
 * Open-thread counts for active admins (My inbox load).
 * @param {string[]} adminIds
 * @returns {Promise<Map<string, number>>}
 */
async function countOpenAssignmentsByAdmin(adminIds) {
  const pool = (adminIds || []).map(String).filter(Boolean);
  const loadByAdminId = new Map(pool.map((id) => [id, 0]));
  if (!pool.length) return loadByAdminId;

  const objectIds = pool
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (!objectIds.length) return loadByAdminId;

  const rows = await EmailThreadAssignment.aggregate([
    {
      $match: {
        status: 'open',
        assignedTo: { $in: objectIds },
      },
    },
    { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
  ]);

  for (const row of rows) {
    if (row?._id != null) {
      loadByAdminId.set(String(row._id), Number(row.count) || 0);
    }
  }
  return loadByAdminId;
}

/**
 * Prefer the active admin with the fewest open threads.
 * Ties are broken at random so the same ObjectId is not always favoured.
 * @param {string[]} pool
 * @param {Map<string, number>} loadByAdminId
 * @returns {string|null}
 */
function pickLeastLoadedAdmin(pool, loadByAdminId) {
  if (!pool?.length) return null;
  let bestCount = Infinity;
  const ties = [];
  for (const rawId of pool) {
    const id = String(rawId);
    const count = loadByAdminId?.get(id) ?? 0;
    if (count < bestCount) {
      bestCount = count;
      ties.length = 0;
      ties.push(id);
    } else if (count === bestCount) {
      ties.push(id);
    }
  }
  return pickRandom(ties);
}

async function upsertContactOwner({
  mailboxEmail,
  contactEmail,
  ownerAdminId,
  threadId,
  claimSource = null,
}) {
  if (!mailboxEmail || !contactEmail || !ownerAdminId) return null;
  const $set = {
    ownerAdminId,
    lastThreadId: threadId || null,
    lastAssignedAt: new Date(),
  };
  if (claimSource) $set.claimSource = claimSource;

  return EmailContactOwner.findOneAndUpdate(
    { mailboxEmail, contactEmail },
    { $set },
    { upsert: true, new: true }
  );
}

async function resolveAssignee({
  mailboxEmail,
  contactEmail,
  activeAdminIds,
  onlineAdminIds,
  loadByAdminId = null,
  preferSticky = true,
}) {
  const pool = activeAdminIds || onlineAdminIds || [];
  if (!pool.length) return { adminId: null, source: null };

  if (preferSticky && contactEmail) {
    const sticky = await EmailContactOwner.findOne({
      mailboxEmail,
      contactEmail,
      claimSource: { $in: ['reply', 'open', 'reassign', 'takeover'] },
    }).lean();
    if (sticky?.ownerAdminId) {
      const stickyId = String(sticky.ownerAdminId);
      if (pool.includes(stickyId)) {
        return { adminId: stickyId, source: 'sticky' };
      }
    }
  }

  const loads =
    loadByAdminId instanceof Map
      ? loadByAdminId
      : await countOpenAssignmentsByAdmin(pool);
  const adminId = pickLeastLoadedAdmin(pool, loads);
  return { adminId, source: adminId ? 'least_load' : null };
}

async function notifyAssigned(adminId, plain) {
  const { emitToUser, emitNotificationToUser } = getSocketHelpers();
  emitToUser(adminId, 'gmail:assigned', { assignment: plain });
  try {
    await emitNotificationToUser(
      adminId,
      'Emails',
      `New email assigned: ${plain.subject || plain.threadId}`,
      'Inbox',
      {
        type: 'email_assigned',
        threadId: plain.threadId,
        mailboxEmail: plain.mailboxEmail,
        assignmentId: String(plain._id),
      }
    );
  } catch (e) {
    console.warn('[Gmail Assignment] notify failed:', e.message);
  }
}

function emitRebalanceMove(plain, previousAssignee, nextAdminId) {
  const { emitToUser } = getSocketHelpers();
  const payload = { assignment: plain, previousAssignee, reason: 'rebalance' };
  emitToUser(nextAdminId, 'gmail:reassigned', payload);
  if (previousAssignee && previousAssignee !== String(nextAdminId)) {
    emitToUser(previousAssignee, 'gmail:reassigned', payload);
  }
}

/**
 * Assign new inbound mail to admins with inbox assignment active.
 * 0 active → queue; 1+ → sticky (if claimed) else fewest open threads.
 * Sticky is NOT set here — only on reply/open/reassign/takeover.
 */
async function assignIncomingMessages({
  mailboxAdminId,
  mailboxEmail,
  messages,
}) {
  if (!mailboxEmail || !messages?.length) {
    return { assigned: [], queued: [], skipped: [] };
  }

  const normalizedMailbox = String(mailboxEmail).trim().toLowerCase();
  const activeAdminIds = await getActiveAdminIds();
  const canAssignLive = activeAdminIds.length >= 1;
  const loadByAdminId = canAssignLive
    ? await countOpenAssignmentsByAdmin(activeAdminIds)
    : new Map();
  const assigned = [];
  const queued = [];
  const skipped = [];
  const seenThreads = new Set();
  const { emitToUser } = getSocketHelpers();

  for (const message of messages) {
    const threadId = resolveGmailThreadId(message);
    if (!threadId) {
      skipped.push({ messageId: message.id, reason: 'missing_gmail_thread_id' });
      continue;
    }
    if (seenThreads.has(threadId)) {
      skipped.push({ threadId, reason: 'duplicate_in_batch' });
      continue;
    }
    seenThreads.add(threadId);

    const contactEmail = extractEmailAddress(message.from);
    if (contactEmail && contactEmail === normalizedMailbox) {
      skipped.push({ threadId, reason: 'from_mailbox' });
      continue;
    }

    const existing = await EmailThreadAssignment.findOne({
      mailboxEmail: normalizedMailbox,
      threadId,
    });

    if (existing) {
      existing.latestMessageId = message.id || existing.latestMessageId;
      existing.subject = message.subject || existing.subject;
      existing.from = message.from || existing.from;
      existing.snippet = message.snippet || existing.snippet;
      if (message.internalDate != null) {
        existing.internalDate = String(message.internalDate);
      }
      if (contactEmail) existing.contactEmail = contactEmail;

      if (existing.status === 'queued' && canAssignLive) {
        const { adminId, source } = await resolveAssignee({
          mailboxEmail: normalizedMailbox,
          contactEmail: existing.contactEmail || contactEmail,
          activeAdminIds,
          loadByAdminId,
        });
        if (adminId) {
          existing.assignedTo = adminId;
          existing.assignmentSource = source;
          existing.status = 'open';
          await existing.save();
          const plain = existing.toObject();
          assigned.push(plain);
          loadByAdminId.set(
            String(adminId),
            (loadByAdminId.get(String(adminId)) || 0) + 1,
          );
          await notifyAssigned(adminId, plain);
          continue;
        }
      }

      await existing.save();
      if (existing.assignedTo) {
        emitToUser(existing.assignedTo, 'gmail:assigned-update', {
          assignment: existing.toObject(),
          message,
        });
      }
      skipped.push({
        threadId,
        reason:
          existing.status === 'queued' ? 'still_queued' : 'already_assigned',
      });
      continue;
    }

    if (!canAssignLive) {
      const doc = await EmailThreadAssignment.create({
        threadId,
        mailboxEmail: normalizedMailbox,
        mailboxAdminId: mailboxAdminId || null,
        assignedTo: null,
        assignmentSource: 'queued',
        status: 'queued',
        contactEmail,
        latestMessageId: message.id || null,
        subject: message.subject || '',
        from: message.from || '',
        snippet: message.snippet || '',
        internalDate:
          message.internalDate != null ? String(message.internalDate) : null,
      });
      queued.push(doc.toObject());
      continue;
    }

    const { adminId, source } = await resolveAssignee({
      mailboxEmail: normalizedMailbox,
      contactEmail,
      activeAdminIds,
      loadByAdminId,
    });
    if (!adminId) {
      skipped.push({ threadId, reason: 'no_assignee' });
      continue;
    }

    const doc = await EmailThreadAssignment.create({
      threadId,
      mailboxEmail: normalizedMailbox,
      mailboxAdminId: mailboxAdminId || null,
      assignedTo: adminId,
      assignmentSource: source,
      status: 'open',
      contactEmail,
      latestMessageId: message.id || null,
      subject: message.subject || '',
      from: message.from || '',
      snippet: message.snippet || '',
      internalDate:
        message.internalDate != null ? String(message.internalDate) : null,
    });

    const plain = doc.toObject();
    assigned.push(plain);
    loadByAdminId.set(
      String(adminId),
      (loadByAdminId.get(String(adminId)) || 0) + 1,
    );
    await notifyAssigned(adminId, plain);
  }

  return { assigned, queued, skipped };
}

/**
 * Re-split open/queued among admins who have assignment active.
 * Drain newest queued first, then newest open — so recent mail hits active admins ASAP.
 */
async function rebalanceAssignmentsAmongActiveAdmins() {
  const activeAdminIds = await getActiveAdminIds();
  if (!activeAdminIds.length) {
    return { moved: 0, activeCount: 0, reason: 'no_active_admins' };
  }

  const newestFirst = { updatedAt: -1 };
  const [queuedDocs, openDocs] = await Promise.all([
    EmailThreadAssignment.find({ status: 'queued' })
      .sort(newestFirst)
      .limit(500),
    EmailThreadAssignment.find({ status: 'open' })
      .sort(newestFirst)
      .limit(500),
  ]);

  // Queued first (unassigned → active pool), then open redistribution; newest within each.
  const docs = [...queuedDocs, ...openDocs].slice(0, 500);

  if (!docs.length) {
    return { moved: 0, activeCount: activeAdminIds.length, reason: 'empty' };
  }

  let moved = 0;
  // Start from current open loads, then adjust as we move threads in this pass.
  const loadByAdminId = await countOpenAssignmentsByAdmin(activeAdminIds);

  for (const doc of docs) {
    const contactEmail = doc.contactEmail || extractEmailAddress(doc.from);
    const previousAssignee = doc.assignedTo ? String(doc.assignedTo) : null;
    const wasQueued = doc.status === 'queued';

    // Temporarily free this thread from the previous assignee so least-load
    // sees the post-move world (avoids pinning everything to one person).
    if (!wasQueued && previousAssignee && loadByAdminId.has(previousAssignee)) {
      loadByAdminId.set(
        previousAssignee,
        Math.max(0, (loadByAdminId.get(previousAssignee) || 0) - 1),
      );
    }

    const { adminId, source } = await resolveAssignee({
      mailboxEmail: doc.mailboxEmail,
      contactEmail,
      activeAdminIds,
      loadByAdminId,
      preferSticky: true,
    });
    if (!adminId) {
      if (!wasQueued && previousAssignee && loadByAdminId.has(previousAssignee)) {
        loadByAdminId.set(
          previousAssignee,
          (loadByAdminId.get(previousAssignee) || 0) + 1,
        );
      }
      continue;
    }

    const nextId = String(adminId);
    if (!wasQueued && previousAssignee === nextId) {
      loadByAdminId.set(nextId, (loadByAdminId.get(nextId) || 0) + 1);
      continue;
    }

    doc.assignedTo = adminId;
    doc.assignmentSource = source === 'sticky' ? 'sticky' : 'rebalance';
    doc.status = 'open';
    await doc.save();

    loadByAdminId.set(nextId, (loadByAdminId.get(nextId) || 0) + 1);

    const plain = doc.toObject();
    // Socket only — no bell notifications for rebalance/queue drain (can be hundreds).
    emitRebalanceMove(plain, previousAssignee, nextId);
    moved += 1;
  }

  console.log(
    `[Gmail Assignment] Rebalanced ${moved} thread(s) across ${activeAdminIds.length} active admin(s)`
  );
  return { moved, activeCount: activeAdminIds.length };
}

async function rebalanceAssignmentsAmongOnlineAdmins() {
  return rebalanceAssignmentsAmongActiveAdmins();
}

/**
 * My inbox list — same shape as Gmail listMessages.
 * Hydrates each row from Gmail message metadata (date, UNREAD labels) so
 * timing + read/unread match main Inbox.
 */
function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listMyInboxMessages({
  assignedTo,
  aiCategory = null,
  maxResults = 20,
  pageToken = null,
  gmailAdminId = null,
  name = null,
  q = null,
}) {
  const ThreadClassification = require('../models/ThreadClassification');
  const { getGmailAuth } = require('./gmailAuthHelper');

  const filter = {
    assignedTo,
    status: { $in: ['open', 'flagged', 'queued'] },
  };

  const aiSlug = String(aiCategory || '').trim().toLowerCase();
  if (aiSlug) {
    const classified = await ThreadClassification.find({ aiCategory: aiSlug })
      .select('threadId')
      .lean();
    const ids = classified.map((d) => d.threadId).filter(Boolean);
    if (!ids.length) {
      return { messages: [], nextPageToken: null, resultSizeEstimate: 0 };
    }
    filter.threadId = { $in: ids };
  }

  const searchTerm = String(name || q || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (searchTerm) {
    const rx = new RegExp(escapeRegex(searchTerm), 'i');
    filter.$or = [
      { from: rx },
      { subject: rx },
      { snippet: rx },
      { contactEmail: rx },
    ];
  }

  const limit = Math.min(Math.max(Number(maxResults) || 20, 1), 50);
  const skip = Math.max(Number(pageToken) || 0, 0);

  const [docs, total] = await Promise.all([
    EmailThreadAssignment.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('flaggedBy', ADMIN_SELECT)
      .populate('assignedBy', ADMIN_SELECT)
      .lean(),
    EmailThreadAssignment.countDocuments(filter),
  ]);

  const threadIds = docs.map((d) => d.threadId).filter(Boolean);
  let classMap = new Map();
  if (threadIds.length) {
    const classDocs = await ThreadClassification.find({
      threadId: { $in: threadIds },
    })
      .select(
        'threadId aiCategory labelIds threadMessageCount date internalDate from subject snippet'
      )
      .lean();
    classMap = new Map(classDocs.map((d) => [d.threadId, d]));
  }

  let gmail = null;
  const authAdminId =
    gmailAdminId ||
    docs.find((d) => d.mailboxAdminId)?.mailboxAdminId ||
    assignedTo;
  try {
    if (authAdminId) gmail = await getGmailAuth(authAdminId);
  } catch (err) {
    console.warn(
      '[Gmail Assignment] My inbox Gmail hydrate skipped:',
      err.message
    );
  }

  async function fetchMeta(messageId) {
    if (!gmail || !messageId) return null;
    try {
      const res = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Cc'],
      });
      const data = res.data;
      const headers = data.payload?.headers || [];
      const getH = (name) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
          ?.value || '';
      return {
        id: data.id,
        threadId: data.threadId,
        snippet: data.snippet || '',
        labelIds: data.labelIds || [],
        internalDate:
          data.internalDate != null ? String(data.internalDate) : '',
        from: getH('From'),
        to: getH('To'),
        cc: getH('Cc'),
        subject: getH('Subject') || '(no subject)',
        date: getH('Date') || '',
      };
    } catch {
      return null;
    }
  }

  const messages = [];
  for (const doc of docs) {
    const cls = classMap.get(doc.threadId);
    const meta = await fetchMeta(doc.latestMessageId);

    const labelIds = Array.isArray(meta?.labelIds)
      ? [...meta.labelIds]
      : Array.isArray(cls?.labelIds)
        ? [...cls.labelIds]
        : [];
    if (!labelIds.includes('INBOX') && !labelIds.includes('TRASH')) {
      labelIds.push('INBOX');
    }

    const internalDate =
      meta?.internalDate ||
      doc.internalDate ||
      cls?.internalDate ||
      (doc.updatedAt ? String(new Date(doc.updatedAt).getTime()) : null);

    const pusher = doc.flaggedBy || doc.assignedBy || null;
    let pushedByName = '';
    let pushedById = null;
    if (pusher && typeof pusher === 'object') {
      pushedById = String(pusher._id || '');
      const full = `${pusher.firstName || ''} ${pusher.lastName || ''}`.trim();
      pushedByName =
        full || pusher.username || pusher.email || pushedById || '';
    } else if (pusher) {
      pushedById = String(pusher);
    }

    messages.push({
      id: meta?.id || doc.latestMessageId || doc.threadId,
      threadId: doc.threadId,
      snippet: meta?.snippet || doc.snippet || cls?.snippet || '',
      labelIds,
      from: meta?.from || doc.from || cls?.from || '',
      to: meta?.to || '',
      cc: meta?.cc || '',
      subject: meta?.subject || doc.subject || cls?.subject || '(no subject)',
      date: meta?.date || cls?.date || '',
      internalDate,
      timestamp: internalDate ? Number(internalDate) : undefined,
      threadMessageCount: cls?.threadMessageCount || 1,
      aiCategory: cls?.aiCategory || null,
      assignmentId: String(doc._id),
      flaggedForAdvice: Boolean(doc.flaggedForAdvice),
      flagNote: doc.flagNote || '',
      flaggedAt: doc.flaggedAt || null,
      assignmentSource: doc.assignmentSource || null,
      pushedBy: pushedById,
      pushedByName,
      mailboxEmail: doc.mailboxEmail,
    });
  }

  const nextSkip = skip + messages.length;
  return {
    messages,
    nextPageToken: nextSkip < total ? String(nextSkip) : null,
    resultSizeEstimate: total,
  };
}

async function claimStickyOnEngagement({
  adminId,
  threadId,
  mailboxEmail = null,
  contactEmail = null,
  claimSource = 'open',
}) {
  if (!adminId || !threadId) return null;
  const gmailThreadId = String(threadId).trim();

  let normalizedMailbox = mailboxEmail
    ? String(mailboxEmail).trim().toLowerCase()
    : null;

  let assignment = await EmailThreadAssignment.findOne({
    threadId: gmailThreadId,
    ...(normalizedMailbox ? { mailboxEmail: normalizedMailbox } : {}),
  });
  if (!assignment) {
    assignment = await EmailThreadAssignment.findOne({
      threadId: gmailThreadId,
    }).sort({ updatedAt: -1 });
  }
  if (!normalizedMailbox) normalizedMailbox = assignment?.mailboxEmail || null;
  if (!normalizedMailbox) {
    const connected = await Admin.findOne({
      gmailEmailAddress: { $exists: true, $nin: [null, ''] },
    })
      .select('gmailEmailAddress')
      .lean();
    if (connected?.gmailEmailAddress) {
      normalizedMailbox = String(connected.gmailEmailAddress)
        .trim()
        .toLowerCase();
    }
  }

  const contact =
    extractEmailAddress(contactEmail) ||
    assignment?.contactEmail ||
    extractEmailAddress(assignment?.from) ||
    '';

  if (!normalizedMailbox || !contact) {
    return { sticky: null, assignment: assignment ? assignment.toObject() : null };
  }

  const sticky = await upsertContactOwner({
    mailboxEmail: normalizedMailbox,
    contactEmail: contact,
    ownerAdminId: adminId,
    threadId: gmailThreadId,
    claimSource,
  });

  if (assignment) {
    const previousAssignee = assignment.assignedTo
      ? String(assignment.assignedTo)
      : null;
    const nextId = String(adminId);
    if (previousAssignee !== nextId || assignment.status === 'queued') {
      assignment.assignedTo = adminId;
      assignment.assignmentSource = 'sticky';
      if (assignment.status === 'queued') assignment.status = 'open';
      if (!assignment.contactEmail) assignment.contactEmail = contact;
      await assignment.save();
      emitRebalanceMove(assignment.toObject(), previousAssignee, nextId);
    }
  }

  return { sticky, assignment: assignment ? assignment.toObject() : null };
}

async function removeAssignmentsForGmailRemoval({
  threadIds = [],
  messageIds = [],
  mailboxEmail = null,
  reason = 'gmail_deleted',
} = {}) {
  const tids = [
    ...new Set(
      (threadIds || []).map((id) => String(id || '').trim()).filter(Boolean)
    ),
  ];
  const mids = [
    ...new Set(
      (messageIds || []).map((id) => String(id || '').trim()).filter(Boolean)
    ),
  ];
  if (!tids.length && !mids.length) return { removed: 0 };

  const or = [];
  if (tids.length) or.push({ threadId: { $in: tids } });
  if (mids.length) or.push({ latestMessageId: { $in: mids } });
  const filter = { $or: or };
  if (mailboxEmail) {
    filter.mailboxEmail = String(mailboxEmail).trim().toLowerCase();
  }

  const docs = await EmailThreadAssignment.find(filter);
  if (!docs.length) return { removed: 0 };

  await EmailThreadAssignment.deleteMany({
    _id: { $in: docs.map((d) => d._id) },
  });

  const { emitToUser } = getSocketHelpers();
  for (const doc of docs) {
    if (doc.assignedTo) {
      emitToUser(doc.assignedTo, 'gmail:assignment-removed', {
        assignment: doc.toObject(),
        reason,
      });
    }
  }
  return { removed: docs.length };
}

async function listAdminsWithPresence() {
  const admins = await Admin.find({})
    .select(`${ADMIN_SELECT} inboxAssignmentActive inboxAssignmentLastActivityAt`)
    .lean();
  return admins.map((admin) => ({
    ...admin,
    assignmentActive: Boolean(admin.inboxAssignmentActive),
    lastActivityAt: admin.inboxAssignmentLastActivityAt || null,
    status: admin.inboxAssignmentActive ? 'active' : 'inactive',
  }));
}

async function getAssignmentStatusForAdmin(adminId) {
  const admin = await Admin.findById(adminId)
    .select('inboxAssignmentActive inboxAssignmentLastActivityAt')
    .lean();
  if (!admin) {
    const err = new Error('Admin not found');
    err.status = 404;
    throw err;
  }
  return {
    assignmentActive: Boolean(admin.inboxAssignmentActive),
    lastActivityAt: admin.inboxAssignmentLastActivityAt || null,
  };
}

async function setAssignmentActiveForAdmin(adminId, active) {
  const now = new Date();
  const update = {
    inboxAssignmentActive: Boolean(active),
    ...(active ? { inboxAssignmentLastActivityAt: now } : {}),
  };
  const admin = await Admin.findByIdAndUpdate(adminId, { $set: update }, { new: true })
    .select(`${ADMIN_SELECT} inboxAssignmentActive inboxAssignmentLastActivityAt`)
    .lean();
  if (!admin) {
    const err = new Error('Admin not found');
    err.status = 404;
    throw err;
  }

  const { emitToAllOnlineAdmins } = getSocketHelpers();
  emitToAllOnlineAdmins('gmail:assignment-active-changed', {
    adminId: String(adminId),
    assignmentActive: Boolean(active),
    lastActivityAt: admin.inboxAssignmentLastActivityAt || null,
  }).catch((e) => {
    console.warn('[Gmail Assignment] active-changed emit failed:', e.message);
  });

  setImmediate(() => {
    rebalanceAssignmentsAmongActiveAdmins().catch((err) => {
      console.warn('[Gmail Assignment] rebalance after active toggle failed:', err.message);
    });
  });

  return {
    assignmentActive: Boolean(admin.inboxAssignmentActive),
    lastActivityAt: admin.inboxAssignmentLastActivityAt || null,
  };
}

async function touchAssignmentActivity(adminId) {
  const admin = await Admin.findById(adminId)
    .select('inboxAssignmentActive')
    .lean();
  if (!admin?.inboxAssignmentActive) {
    return { updated: false, reason: 'not_active' };
  }
  const now = new Date();
  await Admin.findByIdAndUpdate(adminId, {
    $set: { inboxAssignmentLastActivityAt: now },
  });
  return { updated: true, lastActivityAt: now };
}

async function reassignThread({
  threadId,
  mailboxEmail,
  toAdminId,
  fromAdminId,
  note = '',
}) {
  const target = await Admin.findById(toAdminId).select(
    `${ADMIN_SELECT} inboxAssignmentActive`
  );
  if (!target) {
    const err = new Error('Target admin not found');
    err.status = 404;
    throw err;
  }
  if (!target.inboxAssignmentActive) {
    const err = new Error('Target admin is not active for assignments');
    err.status = 400;
    throw err;
  }

  const filter = { threadId: String(threadId) };
  if (mailboxEmail) {
    filter.mailboxEmail = String(mailboxEmail).trim().toLowerCase();
  }

  let assignment = await EmailThreadAssignment.findOne(filter);
  if (!assignment) {
    assignment = await EmailThreadAssignment.findOne({
      threadId: String(threadId),
    }).sort({ updatedAt: -1 });
  }
  if (!assignment) {
    const err = new Error('Assignment not found');
    err.status = 404;
    throw err;
  }

  const previousAssignee = assignment.assignedTo
    ? String(assignment.assignedTo)
    : null;

  const noteText = String(note || '').trim();

  assignment.assignedTo = target._id;
  assignment.assignedBy = fromAdminId || null;
  assignment.assignmentSource = 'reassign';
  // Pushed emails are flagged so the receiver sees them + the note in My inbox.
  assignment.flaggedForAdvice = true;
  assignment.status = 'flagged';
  assignment.flagNote = noteText;
  assignment.flaggedAt = new Date();
  assignment.flaggedBy = fromAdminId || null;
  await assignment.save();

  if (assignment.contactEmail) {
    await upsertContactOwner({
      mailboxEmail: assignment.mailboxEmail,
      contactEmail: assignment.contactEmail,
      ownerAdminId: target._id,
      threadId: assignment.threadId,
      claimSource: 'reassign',
    });
  }

  const plain = assignment.toObject();
  emitRebalanceMove(plain, previousAssignee, String(target._id));
  await notifyAssigned(target._id, plain);

  return plain;
}

module.exports = {
  listAdminsWithPresence,
  getActiveAdminIds,
  getOnlineAdminIds,
  getAssignmentStatusForAdmin,
  setAssignmentActiveForAdmin,
  touchAssignmentActivity,
  assignIncomingMessages,
  rebalanceAssignmentsAmongActiveAdmins,
  rebalanceAssignmentsAmongOnlineAdmins,
  listMyInboxMessages,
  claimStickyOnEngagement,
  removeAssignmentsForGmailRemoval,
  reassignThread,
  extractEmailAddress,
  resolveGmailThreadId,
};
