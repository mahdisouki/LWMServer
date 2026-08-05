const geoip = require('geoip-lite');

/**
 * Resolve approximate location from an IP address.
 * Private / unknown IPs return null fields.
 */
function lookupIpLocation(ip) {
  const empty = { country: null, region: null, city: null, ll: null };

  if (!ip || typeof ip !== 'string') {
    return empty;
  }

  // Strip IPv6-mapped IPv4 prefix
  let cleaned = ip.trim();
  if (cleaned.startsWith('::ffff:')) {
    cleaned = cleaned.slice(7);
  }

  // Skip private / localhost
  if (
    cleaned === '127.0.0.1' ||
    cleaned === '::1' ||
    cleaned === 'localhost' ||
    cleaned.startsWith('10.') ||
    cleaned.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(cleaned)
  ) {
    return empty;
  }

  try {
    const geo = geoip.lookup(cleaned);
    if (!geo) {
      return empty;
    }
    return {
      country: geo.country || null,
      region: geo.region || null,
      city: geo.city || null,
      ll: Array.isArray(geo.ll) ? geo.ll : null,
    };
  } catch (error) {
    console.error('geoip lookup failed:', error.message);
    return empty;
  }
}

module.exports = { lookupIpLocation };
