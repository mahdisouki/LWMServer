const TRAFFIC_SOURCES = {
  GOOGLE_ADS: 'Google Ads',
  MICROSOFT_ADS: 'Microsoft Ads',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  DIRECT: 'Direct',
  ORGANIC: 'Organic',
};

/** Sources set from click ids / utm — never overwritten by GA4 sync. */
const HARD_ATTRIBUTION_SOURCES = new Set([
  TRAFFIC_SOURCES.GOOGLE_ADS,
  TRAFFIC_SOURCES.MICROSOFT_ADS,
  TRAFFIC_SOURCES.INSTAGRAM,
  TRAFFIC_SOURCES.FACEBOOK,
]);

/**
 * Map GA4 sessionDefaultChannelGroup → Task.trafficSource.
 * Returns null when the channel is ambiguous or should not overwrite Organic.
 */
function mapGa4ChannelToTrafficSource(channel) {
  const value = String(channel || '').trim().toLowerCase();
  if (!value || value === '(not set)' || value === 'unassigned') {
    return null;
  }
  if (value === 'direct') {
    return TRAFFIC_SOURCES.DIRECT;
  }
  if (value === 'organic search') {
    return TRAFFIC_SOURCES.ORGANIC;
  }
  // Paid Search / Paid Social / Referral / etc. stay null —
  // click ids and utm_source remain the source of truth for ads/social.
  return null;
}

function canApplyGa4TrafficSource(currentTrafficSource, nextTrafficSource) {
  if (!nextTrafficSource) return false;
  if (HARD_ATTRIBUTION_SOURCES.has(currentTrafficSource)) return false;
  // Only promote Organic (or missing) → Direct from GA4 for now.
  if (nextTrafficSource !== TRAFFIC_SOURCES.DIRECT) return false;
  return (
    !currentTrafficSource
    || currentTrafficSource === TRAFFIC_SOURCES.ORGANIC
  );
}

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

function hasMetaAdsClickId({ fbclid } = {}) {
  return Boolean(fbclid && String(fbclid).trim());
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
 * Prefer Google, then Microsoft, then Meta (fbclid), then Instagram/Facebook from utm_source.
 * Preserves GA4-synced Direct when there is no stronger click/utm signal.
 */
function resolveTrafficSource({
  gclid,
  gbraid,
  wbraid,
  msclkid,
  fbclid,
  utm_source,
  existingTrafficSource,
} = {}) {
  if (hasGoogleAdsClickId({ gclid, gbraid, wbraid })) {
    return TRAFFIC_SOURCES.GOOGLE_ADS;
  }
  if (hasMicrosoftAdsClickId({ msclkid })) {
    return TRAFFIC_SOURCES.MICROSOFT_ADS;
  }
  if (hasMetaAdsClickId({ fbclid })) {
    return TRAFFIC_SOURCES.FACEBOOK;
  }
  const social = resolveSocialTrafficSource(utm_source);
  if (social) {
    return social;
  }
  if (existingTrafficSource === TRAFFIC_SOURCES.DIRECT) {
    return TRAFFIC_SOURCES.DIRECT;
  }
  return TRAFFIC_SOURCES.ORGANIC;
}

const CLICK_ID_FIELDS = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid', 'utm_source'];

function trimClickId(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function pickClickIds(source = {}) {
  const ids = {};
  for (const field of CLICK_ID_FIELDS) {
    const value = trimClickId(source[field]);
    if (value) ids[field] = value;
  }
  return ids;
}

function hasAnyClickId(source = {}) {
  return CLICK_ID_FIELDS.some((field) => trimClickId(source[field]));
}

/** Copy missing click IDs / utm_source from source onto target. */
function mergeClickIdFields(target, source) {
  if (!target || !source) return { changed: false };
  let changed = false;
  for (const field of CLICK_ID_FIELDS) {
    const next = trimClickId(source[field]);
    if (!trimClickId(target[field]) && next) {
      target[field] = next;
      changed = true;
    }
  }
  return { changed };
}

module.exports = {
  TRAFFIC_SOURCES,
  HARD_ATTRIBUTION_SOURCES,
  CLICK_ID_FIELDS,
  hasGoogleAdsClickId,
  hasMicrosoftAdsClickId,
  hasMetaAdsClickId,
  hasAnyClickId,
  pickClickIds,
  mergeClickIdFields,
  normalizeUtmSource,
  resolveSocialTrafficSource,
  resolveTrafficSource,
  mapGa4ChannelToTrafficSource,
  canApplyGa4TrafficSource,
};
