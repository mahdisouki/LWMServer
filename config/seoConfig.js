function getSiteUrl() {
  const raw = process.env.SEO_SITE_URL
    || process.env.CLIENT_URL?.replace(/\/$/, '')
    || 'https://www.londonwastemanagement.com';
  return raw.replace(/\/$/, '');
}

function getSiteHostname() {
  try {
    return new URL(getSiteUrl()).hostname.replace(/^www\./, '');
  } catch {
    return 'londonwastemanagement.com';
  }
}

function getMaxCrawlPages() {
  const n = Number(process.env.SEO_MAX_CRAWL_PAGES || 50);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50;
}

module.exports = {
  getSiteUrl,
  getSiteHostname,
  getMaxCrawlPages,
  getPageSpeedApiKey: () => process.env.GOOGLE_PAGESPEED_API_KEY || process.env.SEO_PAGESPEED_API_KEY || '',
  isGscEnabled: () => process.env.SEO_GSC_ENABLED === 'true',
  getGscSiteUrl: () => process.env.SEO_GSC_SITE_URL || `sc-domain:${getSiteHostname()}`,
};
