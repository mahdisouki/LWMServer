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
  getMaxCompetitors: () => {
    const n = Number(process.env.SEO_MAX_COMPETITORS || 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 25) : 10;
  },
  getDefaultBlogImage: () => process.env.SEO_DEFAULT_BLOG_IMAGE
    || 'https://www.londonwastemanagement.com/wp-content/uploads/2023/01/logo.png',
  isDataForSeoEnabled: () => {
    if (process.env.SEO_METRICS_ENABLED === 'false') {
      return false;
    }
    const login = process.env.DATAFORSEO_LOGIN || process.env.DATAFORSEO_USERNAME;
    const password = process.env.DATAFORSEO_PASSWORD;
    return Boolean(login && password);
  },
  getDataForSeoCredentials: () => ({
    login: process.env.DATAFORSEO_LOGIN || process.env.DATAFORSEO_USERNAME || '',
    password: process.env.DATAFORSEO_PASSWORD || '',
  }),
  getDataForSeoLocationCode: () => {
    const n = Number(process.env.SEO_DATAFORSEO_LOCATION_CODE || 2826);
    return Number.isFinite(n) ? n : 2826;
  },
  getDataForSeoLanguageCode: () => process.env.SEO_DATAFORSEO_LANGUAGE_CODE || 'en',
  isOpenPageRankEnabled: () => Boolean(process.env.OPENPAGERANK_API_KEY),
  getOpenPageRankApiKey: () => process.env.OPENPAGERANK_API_KEY || '',

  isSeoAgentEnabled: () => process.env.SEO_AGENT_ENABLED === 'true',
  getAnthropicApiKey: () => process.env.ANTHROPIC_API_KEY || '',
  getSeoAgentModel: () => process.env.SEO_AGENT_MODEL || 'claude-sonnet-4-5',
  getSeoAgentTimeoutMs: () => {
    const n = Number(process.env.SEO_AGENT_TIMEOUT_MS || 90000);
    return Number.isFinite(n) && n > 0 ? n : 90000;
  },
  getSeoAgentMaxIssues: () => {
    const n = Number(process.env.SEO_AGENT_MAX_ISSUES || 40);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 40;
  },
  getMaxInspectUrls: () => {
    const n = Number(process.env.SEO_INSPECT_MAX_URLS || 40);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 40;
  },
};
