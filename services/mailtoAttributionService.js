const MailtoLead = require('../models/MailtoLead');
const {
  normalizeUtmSource,
  pickClickIds,
  mergeClickIdFields,
  hasAnyClickId,
} = require('../utils/trafficSource');
const { normalizeEmail } = require('./quotationTaskMatchingService');

const MAX_FIELD = 255;
const CANDIDATE_LIMIT = 50;
const SESSION_RE =
  /LWM-REF:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|s_[A-Za-z0-9_]+)/i;

/** hello+{prefix}{id}@… from tracked mailto CC (longer prefixes first). */
const HELLO_ADS_CC_RE =
  /hello\+((?:gb|wb|g|m|f)\.)([A-Za-z0-9._-]+)@londonwastemanagement\.com/gi;

const HELLO_PREFIX_TO_FIELD = {
  'g.': 'gclid',
  'gb.': 'gbraid',
  'wb.': 'wbraid',
  'm.': 'msclkid',
  'f.': 'fbclid',
};

function clip(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_FIELD ? trimmed.slice(0, MAX_FIELD) : trimmed;
}

function buildLeadClickIds(body = {}) {
  return pickClickIds({
    ...body,
    utm_source: normalizeUtmSource(body.utm_source),
  });
}

function extractEmailAddress(fromHeader) {
  if (!fromHeader) return '';
  const match = String(fromHeader).match(/<([^>]+)>/);
  if (match) return match[1].trim().toLowerCase();
  if (/@/.test(fromHeader)) return String(fromHeader).trim().toLowerCase();
  return '';
}

function extractSessionIdFromText(text) {
  if (!text) return null;
  const match = String(text).match(SESSION_RE);
  return clip(match?.[1]);
}

/**
 * Parse every hello+g./gb./wb./m./f. address in the blob into click ID fields.
 * Example: hello+g.EaAbc123@londonwastemanagement.com → gclid
 */
function extractClickIdsFromHelloAddresses(text) {
  const ids = {};
  if (!text) return ids;

  const re = new RegExp(HELLO_ADS_CC_RE.source, 'gi');
  let match;
  while ((match = re.exec(String(text))) !== null) {
    const prefix = String(match[1] || '').toLowerCase();
    const value = clip(match[2]);
    const field = HELLO_PREFIX_TO_FIELD[prefix];
    if (field && value && !ids[field]) {
      ids[field] = value;
    }
  }
  return ids;
}

function inboundSearchBlob(message = {}) {
  const parts = [
    message.subject,
    message.snippet,
    message.content,
    message.to,
    message.cc,
    message.bcc,
  ];
  return parts
    .map((part) => (part == null ? '' : String(part)))
    .join('\n');
}

async function upsertMailtoLead(payload = {}) {
  const sessionId = clip(payload.sessionId);
  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  const email = normalizeEmail(payload.email) || null;
  const clickIds = buildLeadClickIds(payload);

  const update = {
    $set: {
      lastSeenAt: new Date(),
      event: clip(payload.event) || 'mailto_click',
    },
    $setOnInsert: {
      sessionId,
    },
  };

  if (email) update.$set.email = email;

  for (const [field, value] of Object.entries(clickIds)) {
    if (value) update.$set[field] = value;
  }

  return MailtoLead.findOneAndUpdate({ sessionId }, update, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  });
}

/**
 * When a customer emails hello@ after clicking mailto, attach their From address
 * and every ads ID encoded in hello+… CC addresses so Admin orders inherit them.
 */
async function attachMailtoLeadFromInboundEmail(message = {}) {
  const fromEmail = extractEmailAddress(message.from);
  if (!fromEmail || fromEmail.endsWith('@londonwastemanagement.com')) {
    return null;
  }

  const blob = inboundSearchBlob(message);
  const clickIdsFromCc = extractClickIdsFromHelloAddresses(blob);
  const sessionFromBody = extractSessionIdFromText(blob);
  const sessionId =
    sessionFromBody
    || clip(message.id ? `gmail_${message.id}` : null);

  if (!sessionId) return null;
  if (!sessionFromBody && !hasAnyClickId(clickIdsFromCc)) {
    return null;
  }

  const update = {
    $set: {
      email: fromEmail,
      lastSeenAt: new Date(),
      event: hasAnyClickId(clickIdsFromCc) ? 'mailto_inbound_cc' : 'mailto_inbound',
    },
    $setOnInsert: {
      sessionId,
    },
  };

  for (const [field, value] of Object.entries(clickIdsFromCc)) {
    if (value) update.$set[field] = value;
  }

  const lead = await MailtoLead.findOneAndUpdate({ sessionId }, update, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  });

  if (lead) {
    console.log('[Mailto Attribution] Attached sender + click IDs from inbound mail', {
      sessionId,
      email: fromEmail,
      gclid: lead.gclid || null,
      gbraid: lead.gbraid || null,
      wbraid: lead.wbraid || null,
      msclkid: lead.msclkid || null,
      fbclid: lead.fbclid || null,
    });
  }

  return lead;
}

async function findMatchingMailtoLead(task = {}) {
  const emailNorm = normalizeEmail(task.email);
  if (!emailNorm) return null;

  const before = task.createdAt ? new Date(task.createdAt) : new Date();
  const candidates = await MailtoLead.find({
    lastSeenAt: { $lte: before },
    email: emailNorm,
  })
    .sort({ lastSeenAt: -1 })
    .limit(CANDIDATE_LIMIT);

  let fallback = null;
  for (const lead of candidates) {
    if (hasAnyClickId(lead)) return lead;
    if (!fallback) fallback = lead;
  }

  return fallback;
}

/** Copy missing click IDs from a matching mailto click onto the task (does not overwrite). */
async function applyMailtoClickIdsToTask(task) {
  if (!task) return { changed: false, lead: null };

  const lead = await findMatchingMailtoLead(task);
  if (!lead) return { changed: false, lead: null };

  const { changed } = mergeClickIdFields(task, lead);
  if (changed) {
    console.log('[Mailto Attribution] Applied click IDs from mailto click', {
      leadId: lead._id?.toString?.() || lead._id,
      email: lead.email || null,
      sessionId: lead.sessionId || null,
    });
  }
  return { changed, lead };
}

module.exports = {
  upsertMailtoLead,
  attachMailtoLeadFromInboundEmail,
  findMatchingMailtoLead,
  applyMailtoClickIdsToTask,
  extractSessionIdFromText,
  extractClickIdsFromHelloAddresses,
};
