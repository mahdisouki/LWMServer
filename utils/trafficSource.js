const TRAFFIC_SOURCES = {
  GOOGLE_ADS: 'Google Ads',
  MICROSOFT_ADS: 'Microsoft Ads',
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
 * Prefer Google when both are present (rare). Microsoft only if no Google click IDs.
 */
function resolveTrafficSource({ gclid, gbraid, wbraid, msclkid } = {}) {
  if (hasGoogleAdsClickId({ gclid, gbraid, wbraid })) {
    return TRAFFIC_SOURCES.GOOGLE_ADS;
  }
  if (hasMicrosoftAdsClickId({ msclkid })) {
    return TRAFFIC_SOURCES.MICROSOFT_ADS;
  }
  return TRAFFIC_SOURCES.ORGANIC;
}

module.exports = {
  TRAFFIC_SOURCES,
  hasGoogleAdsClickId,
  hasMicrosoftAdsClickId,
  resolveTrafficSource,
};
