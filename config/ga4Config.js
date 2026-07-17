/**
 * Google Analytics 4 Data API config.
 * Measurement ID on the public site is G-QSPNJ1BS7C — the Data API needs the numeric Property ID.
 */
function isGa4Enabled() {
  if (process.env.GA4_ENABLED === 'false') {
    return false;
  }
  return Boolean(getGa4PropertyId());
}

function getGa4PropertyId() {
  const raw = String(process.env.GA4_PROPERTY_ID || '').trim();
  if (!raw) {
    return '';
  }
  return raw.replace(/^properties\//i, '');
}

function getGa4Timezone() {
  return process.env.GA4_TIMEZONE
    || process.env.CLARITY_CRON_TIMEZONE
    || 'Europe/London';
}

module.exports = {
  isGa4Enabled,
  getGa4PropertyId,
  getGa4Timezone,
};
