const crypto = require('crypto');

/**
 * Mirror client-lwm src/utils/enhancedConversions.ts hashing rules for Google Ads API upload.
 */

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') {
    return null;
  }
  const normalized = email.trim().toLowerCase();
  return normalized || null;
}

function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  let digits = phone.replace(/\D/g, '');
  if (!digits) {
    return null;
  }

  if (digits.startsWith('44')) {
    return `+${digits}`;
  }

  if (digits.startsWith('0')) {
    return `+44${digits.slice(1)}`;
  }

  if (digits.length === 10) {
    return `+44${digits}`;
  }

  return `+${digits}`;
}

function hashEmail(email) {
  const normalized = normalizeEmail(email);
  return normalized ? sha256Hex(normalized) : null;
}

function hashPhone(phone) {
  const normalized = normalizePhone(phone);
  return normalized ? sha256Hex(normalized) : null;
}

function buildUserIdentifiers({ email, phone, phoneNumber, phoneNumber2 }) {
  const identifiers = [];
  const hashedEmail = hashEmail(email);
  if (hashedEmail) {
    identifiers.push({ hashedEmail });
  }

  const hashedPhone = hashPhone(phone || phoneNumber || phoneNumber2);
  if (hashedPhone) {
    identifiers.push({ hashedPhoneNumber: hashedPhone });
  }

  return identifiers;
}

function formatConversionDateTime(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    return formatConversionDateTime(new Date());
  }

  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getUTCFullYear();
  const month = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hours = pad(d.getUTCHours());
  const minutes = pad(d.getUTCMinutes());
  const seconds = pad(d.getUTCSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}+00:00`;
}

module.exports = {
  normalizeEmail,
  normalizePhone,
  hashEmail,
  hashPhone,
  buildUserIdentifiers,
  formatConversionDateTime,
};
