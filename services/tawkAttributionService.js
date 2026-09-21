const TawkLead = require('../models/TawkLead');
const {
  normalizeUtmSource,
  pickClickIds,
  mergeClickIdFields,
  hasAnyClickId,
} = require('../utils/trafficSource');
const {
  normalizeEmail,
  normalizePhone,
  normalizeName,
} = require('./quotationTaskMatchingService');

const MAX_FIELD = 255;
const CANDIDATE_LIMIT = 50;

function clip(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_FIELD ? trimmed.slice(0, MAX_FIELD) : trimmed;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildLeadClickIds(body = {}) {
  return pickClickIds({
    ...body,
    utm_source: normalizeUtmSource(body.utm_source),
  });
}

function taskFullName({ firstName, lastName, name } = {}) {
  if (name) return normalizeName(name);
  return normalizeName(`${firstName || ''} ${lastName || ''}`);
}

function leadMatchesTask(lead, task) {
  if (!lead || !task) return false;

  const leadEmail = normalizeEmail(lead.email);
  const leadPhone = normalizePhone(lead.phoneNormalized || lead.phone);
  const leadName = normalizeName(lead.name);

  if (leadEmail && normalizeEmail(task.email) === leadEmail) {
    return true;
  }

  if (leadPhone) {
    if (normalizePhone(task.phoneNumber) === leadPhone) return true;
    if (normalizePhone(task.phoneNumber2) === leadPhone) return true;
  }

  if (leadName) {
    const taskName = taskFullName(task);
    if (taskName && leadName === taskName) return true;
  }

  return false;
}

async function upsertTawkLead(payload = {}) {
  const sessionId = clip(payload.sessionId);
  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  const email = normalizeEmail(payload.email) || null;
  const phoneNormalized = normalizePhone(payload.phone) || null;
  const clickIds = buildLeadClickIds(payload);

  const update = {
    $set: {
      lastSeenAt: new Date(),
      event: clip(payload.event),
    },
    $setOnInsert: {
      sessionId,
    },
  };

  if (email) update.$set.email = email;
  if (phoneNormalized) {
    update.$set.phone = clip(payload.phone);
    update.$set.phoneNormalized = phoneNormalized;
  }
  if (clip(payload.name)) update.$set.name = clip(payload.name);
  if (clip(payload.landing_page) || clip(payload.landingPage)) {
    update.$set.landingPage = clip(payload.landing_page) || clip(payload.landingPage);
  }
  if (clip(payload.traffic_source) || clip(payload.trafficSource)) {
    update.$set.trafficSource = clip(payload.traffic_source) || clip(payload.trafficSource);
  }

  for (const [field, value] of Object.entries(clickIds)) {
    if (value) update.$set[field] = value;
  }

  return TawkLead.findOneAndUpdate(
    { sessionId },
    update,
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

/**
 * Newest Tawk lead before the order, matching email / phone / name.
 * Prefers a lead that still has click IDs.
 */
async function findMatchingTawkLead(task = {}) {
  const before = task.createdAt ? new Date(task.createdAt) : new Date();
  const emailNorm = normalizeEmail(task.email);
  const phones = [
    normalizePhone(task.phoneNumber),
    normalizePhone(task.phoneNumber2),
  ].filter(Boolean);
  const nameNorm = taskFullName(task);

  const or = [];
  if (emailNorm) {
    or.push({ email: emailNorm });
  }
  for (const phone of phones) {
    const suffix = phone.length >= 9 ? phone.slice(-9) : phone;
    or.push({ phoneNormalized: { $regex: suffix } });
  }
  if (nameNorm) {
    or.push({ name: { $regex: new RegExp(`^${escapeRegex(nameNorm)}$`, 'i') } });
  }

  if (!or.length) return null;

  const candidates = await TawkLead.find({
    lastSeenAt: { $lte: before },
    $or: or,
  })
    .sort({ lastSeenAt: -1 })
    .limit(CANDIDATE_LIMIT);

  let fallback = null;
  for (const lead of candidates) {
    if (!leadMatchesTask(lead, task)) continue;
    if (hasAnyClickId(lead)) return lead;
    if (!fallback) fallback = lead;
  }

  return fallback;
}

/**
 * Fill missing click IDs on a new Admin task from a matching Tawk chat lead.
 * Body-provided IDs always win.
 */
async function resolveClickIdsForNewTask({
  email,
  phoneNumber,
  phoneNumber2,
  firstName,
  lastName,
  createdAt,
  gclid,
  gbraid,
  wbraid,
  msclkid,
  fbclid,
  utm_source,
} = {}) {
  const resolved = pickClickIds({
    gclid,
    gbraid,
    wbraid,
    msclkid,
    fbclid,
    utm_source: normalizeUtmSource(utm_source),
  });

  const previewTask = {
    email,
    phoneNumber,
    phoneNumber2,
    firstName,
    lastName,
    createdAt: createdAt ? new Date(createdAt) : new Date(),
  };

  try {
    const lead = await findMatchingTawkLead(previewTask);
    if (lead) mergeClickIdFields(resolved, lead);
  } catch (error) {
    console.error('[Tawk Attribution] Failed to match chat lead:', error.message);
  }

  return resolved;
}

function clickIdsForResponse(source) {
  if (!source) return {};
  return pickClickIds(source);
}

module.exports = {
  upsertTawkLead,
  findMatchingTawkLead,
  resolveClickIdsForNewTask,
  clickIdsForResponse,
  leadMatchesTask,
};
