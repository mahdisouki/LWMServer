const FREE_EMAIL_DOMAINS = [
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
  'aol.com',
  'aol.co.uk',
  'live.co.uk',
  'live.com',
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
