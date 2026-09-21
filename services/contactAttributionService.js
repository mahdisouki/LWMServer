const ContactRequest = require('../models/ContactRequest');
const {
  mergeClickIdFields,
  hasAnyClickId,
} = require('../utils/trafficSource');
const {
  normalizeEmail,
  normalizePhone,
  normalizeName,
} = require('./quotationTaskMatchingService');

const CANDIDATE_LIMIT = 50;

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function taskFullName({ firstName, lastName, name } = {}) {
  if (name) return normalizeName(name);
  return normalizeName(`${firstName || ''} ${lastName || ''}`);
}

function contactMatchesTask(contact, task) {
  if (!contact || !task) return false;

  const contactEmail = normalizeEmail(contact.email);
  const contactPhone = normalizePhone(contact.phone);
  const contactName = normalizeName(
    `${contact.firstName || ''} ${contact.lastName || ''}`,
  );

  if (contactEmail && normalizeEmail(task.email) === contactEmail) {
    return true;
  }

  if (contactPhone) {
    if (normalizePhone(task.phoneNumber) === contactPhone) return true;
    if (normalizePhone(task.phoneNumber2) === contactPhone) return true;
  }

  if (contactName) {
    const name = taskFullName(task);
    if (name && contactName === name) return true;
  }

  return false;
}

/**
 * Newest contact-form submission before the order, matching email / phone / name.
 * Prefers a contact that still has click IDs.
 */
async function findMatchingContactRequest(task = {}) {
  const before = task.createdAt ? new Date(task.createdAt) : new Date();
  const emailNorm = normalizeEmail(task.email);
  const phones = [
    normalizePhone(task.phoneNumber),
    normalizePhone(task.phoneNumber2),
  ].filter(Boolean);
  const nameNorm = taskFullName(task);

  const or = [];
  if (emailNorm) {
    or.push({ email: { $regex: new RegExp(`^${escapeRegex(emailNorm)}$`, 'i') } });
  }
  for (const phone of phones) {
    const suffix = phone.length >= 9 ? phone.slice(-9) : phone;
    or.push({ phone: { $regex: suffix } });
  }
  if (nameNorm) {
    const parts = nameNorm.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      or.push({
        firstName: { $regex: new RegExp(`^${escapeRegex(parts[0])}$`, 'i') },
        lastName: {
          $regex: new RegExp(`^${escapeRegex(parts.slice(1).join(' '))}$`, 'i'),
        },
      });
    }
  }

  if (!or.length) return null;

  const candidates = await ContactRequest.find({
    createdAt: { $lte: before },
    $or: or,
  })
    .sort({ createdAt: -1 })
    .limit(CANDIDATE_LIMIT);

  let fallback = null;
  for (const contact of candidates) {
    if (!contactMatchesTask(contact, task)) continue;
    if (hasAnyClickId(contact)) return contact;
    if (!fallback) fallback = contact;
  }

  return fallback;
}

/** Copy missing click IDs from a matching contact form onto the task (does not overwrite). */
async function applyContactClickIdsToTask(task) {
  if (!task) return { changed: false, contact: null };

  const contact = await findMatchingContactRequest(task);
  if (!contact) return { changed: false, contact: null };

  const { changed } = mergeClickIdFields(task, contact);
  if (changed) {
    console.log('[Contact Attribution] Applied click IDs from contact form', {
      contactId: contact._id?.toString?.() || contact._id,
      email: contact.email || null,
    });
  }
  return { changed, contact };
}

module.exports = {
  findMatchingContactRequest,
  contactMatchesTask,
  applyContactClickIdsToTask,
};
