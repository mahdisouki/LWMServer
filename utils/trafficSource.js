const TRAFFIC_SOURCES = {
  GOOGLE_ADS: 'Google Ads',
  MICROSOFT_ADS: 'Microsoft Ads',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  ORGANIC: 'Organic',
};

function hasGoogleAdsClickId({ gclid, gbraid, wbraid } = {}) {
  return Boolean(
    (gclid && String(gclid).trim())
    || (gbraid && String(gbraid).trim())
    || (wbraid && String(wbraid).trim()),
  );
}

function hasMicrosoftAdsClickId({ msclkid } = {}) {
  return Boolean(msclkid && String(msclkid).trim());
}

/**
 * Normalize utm_source from the client (URL param or body).
 * Accepts common aliases: ig, fb, meta.
 */
function normalizeUtmSource(utm_source) {
  if (utm_source == null || utm_source === '') return null;
  const value = String(utm_source).trim().toLowerCase();
  if (!value) return null;

  if (value === 'instagram' || value === 'ig') {
    return 'instagram';
  }
  if (value === 'facebook' || value === 'fb' || value === 'meta') {
    return 'facebook';
  }
  return value;
}

function resolveSocialTrafficSource(utm_source) {
  const normalized = normalizeUtmSource(utm_source);
  if (normalized === 'instagram') return TRAFFIC_SOURCES.INSTAGRAM;
  if (normalized === 'facebook') return TRAFFIC_SOURCES.FACEBOOK;
  return null;
}

/**
 * Prefer Google, then Microsoft, then Instagram/Facebook from utm_source.
 */
function resolveTrafficSource({ gclid, gbraid, wbraid, msclkid, utm_source } = {}) {
  if (hasGoogleAdsClickId({ gclid, gbraid, wbraid })) {
    return TRAFFIC_SOURCES.GOOGLE_ADS;
  }
  if (hasMicrosoftAdsClickId({ msclkid })) {
    return TRAFFIC_SOURCES.MICROSOFT_ADS;
  }
  const social = resolveSocialTrafficSource(utm_source);
  if (social) {
    return social;
  }
  return TRAFFIC_SOURCES.ORGANIC;
}

module.exports = {
  TRAFFIC_SOURCES,
  hasGoogleAdsClickId,
  hasMicrosoftAdsClickId,
  normalizeUtmSource,
  resolveSocialTrafficSource,
  resolveTrafficSource,
};
