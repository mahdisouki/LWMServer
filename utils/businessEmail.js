const FREE_EMAIL_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'live.com',
  'icloud.com',
  'aol.com',
];

function computeIsBusinessEmail(email) {
  const domain = String(email || '')
    .trim()
    .toLowerCase()
    .split('@')[1];
  if (!domain) return false;
  return !FREE_EMAIL_DOMAINS.includes(domain);
}

function resolveIsBusinessEmail(email, excludedFromBusinessList) {
  if (excludedFromBusinessList) return false;
  return computeIsBusinessEmail(email);
}

module.exports = { computeIsBusinessEmail, resolveIsBusinessEmail };
