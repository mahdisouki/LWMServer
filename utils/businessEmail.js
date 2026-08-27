const FreeEmailDomain = require('../models/FreeEmailDomain');

const STATIC_FREE_EMAIL_DOMAINS = [
  'gmail.com',
  'gmail.co.uk',
  'googlemail.com',
  'googlemail.co.uk',
  'yahoo.com',
  'yahoo.co.uk',
  'ymail.com',
  'ymail.co.uk',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'outlook.co.uk',
  'icloud.com',
  'icloud.co.uk',
  'me.com',
  'aol.com',
  'aol.co.uk',
  'live.co.uk',
  'live.com',
  'btinternet.com',
];

const staticFreeEmailDomainSet = new Set(STATIC_FREE_EMAIL_DOMAINS);
const extraFreeEmailDomainSet = new Set();

function extractEmailDomain(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .split('@')[1] || '';
}

function isFreeEmailDomain(domain) {
  if (!domain) return false;
  return (
    staticFreeEmailDomainSet.has(domain) || extraFreeEmailDomainSet.has(domain)
  );
}

function computeIsBusinessEmail(email) {
  const domain = extractEmailDomain(email);
  if (!domain) return false;
  return !isFreeEmailDomain(domain);
}

function resolveIsBusinessEmail(email, excludedFromBusinessList) {
  if (excludedFromBusinessList) return false;
  return computeIsBusinessEmail(email);
}

async function loadExtraFreeEmailDomains() {
  const docs = await FreeEmailDomain.find({}).select('domain').lean();
  extraFreeEmailDomainSet.clear();
  for (const doc of docs) {
    if (doc.domain) extraFreeEmailDomainSet.add(doc.domain);
  }
  return extraFreeEmailDomainSet.size;
}

/**
 * Persist a domain as free/consumer and update the in-memory list.
 * Returns added:false when the domain is already free (static or stored).
 */
async function addFreeEmailDomain(domain) {
  const normalized = String(domain || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    throw new Error('Email domain is required.');
  }
  if (isFreeEmailDomain(normalized)) {
    return { domain: normalized, added: false };
  }

  await FreeEmailDomain.create({ domain: normalized });
  extraFreeEmailDomainSet.add(normalized);
  return { domain: normalized, added: true };
}

module.exports = {
  STATIC_FREE_EMAIL_DOMAINS,
  extractEmailDomain,
  isFreeEmailDomain,
  computeIsBusinessEmail,
  resolveIsBusinessEmail,
  loadExtraFreeEmailDomains,
  addFreeEmailDomain,
};
