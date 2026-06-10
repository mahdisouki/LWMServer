const net = require('net');
const { chromium } = require('playwright');

// Resource types we are willing to fetch when rendering an email.
// Scripts, websockets, iframes, media, fetch/XHR, eventsource etc. are all blocked.
const ALLOWED_RESOURCE_TYPES = new Set(['document', 'image', 'stylesheet', 'font']);
// Allowed URL schemes for outbound requests from the headless browser.
const ALLOWED_PROTOCOLS = new Set(['https:', 'data:']);

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

// Reject literal addresses that would let the headless browser reach the
// host's loopback, link-local, or RFC1918 ranges (basic SSRF guard).
function isPrivateOrLocalHost(hostname) {
  if (!hostname) return true;
  const host = hostname.toLowerCase();

  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    return true;
  }

  if (net.isIPv4(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  if (net.isIPv6(host)) {
    if (host === '::1' || host === '::') return true;
    if (host.startsWith('fc') || host.startsWith('fd')) return true; // ULA
    if (host.startsWith('fe80')) return true; // link-local
    return false;
  }

  return false;
}

function buildPrintDocument(email) {
  const subject = escapeHtml(email.subject || '(no subject)');

  const metaRows = [
    ['From', email.from],
    ['To', email.to],
    ['Cc', email.cc],
    ['Bcc', email.bcc],
    ['Date', email.date],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<div><b>${label}</b> ${escapeHtml(value)}</div>`)
    .join('');

  const attachments = (email.attachments || [])
    .map((a) => escapeHtml(a.filename || a.originalname || a.name || ''))
    .filter(Boolean);

  const attachmentBlock = attachments.length
    ? `<div class="attachments"><b>Attachments (${attachments.length})</b>${attachments.join(', ')}</div>`
    : '';

  const body = email.content || email.snippet || '';

  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:;">
<title>${subject}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #222; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  .meta { border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; padding: 8px 0; margin: 0 0 16px; font-size: 12px; color: #444; }
  .meta div { margin: 2px 0; }
  .meta b { display: inline-block; width: 60px; color: #666; font-weight: 600; }
  .attachments { font-size: 12px; color: #444; margin: 0 0 16px; }
  .attachments b { display: block; margin-bottom: 4px; color: #666; }
  .body { font-size: 14px; line-height: 1.5; }
  .body img { max-width: 100%; height: auto; }
  .body table { max-width: 100%; }
  .body pre { white-space: pre-wrap; word-wrap: break-word; }
  @page { margin: 18mm; }
</style>
</head><body>
<h1>${subject}</h1>
<div class="meta">${metaRows}</div>
${attachmentBlock}
<div class="body">${body}</div>
</body></html>`;
}

// Long-lived headless Chromium so each PDF request reuses the same browser
// instead of paying the ~1-2s launch cost every time. A fresh context is
// created per request for isolation.
let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
      .then((browser) => {
        browser.on('disconnected', () => {
          if (browserPromise && browserPromise._instance === browser) {
            browserPromise = null;
          }
        });
        browserPromise._instance = browser;
        return browser;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

async function renderEmailPdf(email) {
  const allowExternalImages = process.env.MAIL_PDF_ALLOW_EXTERNAL_IMAGES !== 'false';
  const html = buildPrintDocument(email);

  const browser = await getBrowser();
  const context = await browser.newContext({
    javaScriptEnabled: false,
    serviceWorkers: 'block',
  });

  try {
    const page = await context.newPage();

    await page.route('**/*', (route) => {
      const request = route.request();
      const type = request.resourceType();

      if (!ALLOWED_RESOURCE_TYPES.has(type)) {
        return route.abort();
      }

      let parsed;
      try {
        parsed = new URL(request.url());
      } catch (_) {
        return route.abort();
      }

      if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
        return route.abort();
      }

      if (parsed.protocol === 'data:') {
        return route.continue();
      }

      if (!allowExternalImages) {
        return route.abort();
      }

      if (isPrivateOrLocalHost(parsed.hostname)) {
        return route.abort();
      }

      return route.continue();
    });

    await page.setContent(html, {
      waitUntil: 'load',
      timeout: 15000,
    });

    // Ensure each <img> has either loaded or errored before printing (capped at 8s).
    await page.evaluate(async () => {
      const images = Array.from(document.images || []);
      if (!images.length) return;
      const waiters = images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      });
      await Promise.race([
        Promise.all(waiters),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
    });

    return pdf;
  } finally {
    // Closing the context (not the browser) frees memory but keeps the
    // launched Chromium warm for the next call.
    await context.close().catch(() => {});
  }
}

async function shutdownPdfBrowser() {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      await browser.close();
    } catch (_) {
      // ignore
    } finally {
      browserPromise = null;
    }
  }
}

module.exports = { renderEmailPdf, shutdownPdfBrowser };
