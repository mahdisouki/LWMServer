const TRAFFIC_SOURCES = {
  GOOGLE_ADS: 'Google Ads',
  ORGANIC: 'Organic',
};

function hasGoogleAdsClickId({ gclid, gbraid, wbraid } = {}) {
  return Boolean(
    (gclid && String(gclid).trim())
    || (gbraid && String(gbraid).trim())
    || (wbraid && String(wbraid).trim()),
  );
}

function resolveTrafficSource({ gclid, gbraid, wbraid } = {}) {
  return hasGoogleAdsClickId({ gclid, gbraid, wbraid })
    ? TRAFFIC_SOURCES.GOOGLE_ADS
    : TRAFFIC_SOURCES.ORGANIC;
}

module.exports = {
  TRAFFIC_SOURCES,
  hasGoogleAdsClickId,
  resolveTrafficSource,
};
