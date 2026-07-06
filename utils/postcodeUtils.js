function normalizePostcode(postcode) {
  return String(postcode || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function extractOutwardCode(postcode) {
  const normalized = normalizePostcode(postcode);
  if (!normalized) {
    return '';
  }
  return normalized.split(' ')[0];
}

module.exports = {
  normalizePostcode,
  extractOutwardCode,
};
