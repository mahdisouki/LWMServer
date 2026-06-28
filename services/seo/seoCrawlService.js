const axios = require('axios');
const { getSiteUrl, getMaxCrawlPages } = require('../../config/seoConfig');

const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT = 'LWM-SEO-Crawler/1.0 (+https://www.londonwastemanagement.com)';

function resolveUrl(base, href) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function isSameSite(url, siteOrigin) {
  try {
    const u = new URL(url);
    const s = new URL(siteOrigin);
    return u.hostname === s.hostname;
  } catch {
    return false;
  }
}

function extractTag(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1].trim() : '';
}

function parsePageSeo(url, html) {
  const title = extractTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription = extractTag(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || extractTag(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const canonical = extractTag(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i)
    || extractTag(html, /<link[^>]+href=["']([^"']*)["'][^>]+rel=["']canonical["']/i);
  const robotsMeta = extractTag(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i)
    || extractTag(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']robots["']/i);
  const h1Matches = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/gi) || [];
  const hasNoindex = /noindex/i.test(robotsMeta);
  const isCartOrCheckout = /\/(cart|checkout|order-checkout|payment)/i.test(url);

  return {
    url,
    title,
    titleLength: title.length,
    metaDescription,
    metaDescriptionLength: metaDescription.length,
    canonical,
    robotsMeta,
    hasNoindex,
    h1Count: h1Matches.length,
    isCartOrCheckout,
    htmlLength: html.length,
  };
}

async function fetchText(url) {
  const { data } = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return typeof data === 'string' ? data : '';
}

async function discoverSitemapUrls(siteUrl) {
  const candidates = [
    `${siteUrl}/sitemap.xml`,
    `${siteUrl}/sitemap_index.xml`,
    `${siteUrl}/sitemap-index.xml`,
  ];
  const urls = new Set();

  for (const sitemapUrl of candidates) {
    try {
      const xml = await fetchText(sitemapUrl);
      const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());
      for (const loc of locs) {
        if (isSameSite(loc, siteUrl)) {
          urls.add(loc.split('#')[0]);
        }
      }
      if (urls.size > 0) {
        break;
      }
    } catch {
      // try next candidate
    }
  }

  if (urls.size === 0) {
    urls.add(siteUrl);
    urls.add(`${siteUrl}/`);
  }

  return [...urls].slice(0, getMaxCrawlPages());
}

async function crawlSite(siteUrl = getSiteUrl()) {
  const normalizedSite = siteUrl.replace(/\/$/, '');
  const pageUrls = await discoverSitemapUrls(normalizedSite);
  const pages = [];
  const errors = [];

  for (const url of pageUrls) {
    try {
      const html = await fetchText(url);
      pages.push(parsePageSeo(url, html));
    } catch (error) {
      errors.push({ url, message: error.message });
    }
  }

  return {
    siteUrl: normalizedSite,
    pages,
    errors,
    sitemapPageCount: pageUrls.length,
  };
}

module.exports = {
  crawlSite,
  parsePageSeo,
  discoverSitemapUrls,
};
