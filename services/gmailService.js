const crypto = require('crypto');
const { getGmailAuth } = require('./gmailAuthHelper');
const Admin = require('../models/Admin');
const fs = require('fs');

function encodeMessage(raw) {
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

/** RFC 5322: header block + blank line + body. */
function buildRawMime(headerLines, body) {
  const headerBlock = headerLines.join('\r\n');
  return `${headerBlock}\r\n\r\n${body}`;
}

function formatRfcMessageId(value) {
  if (!value) return '';
  const s = String(value).trim();
  if (!s) return '';
  return s.startsWith('<') ? s : `<${s}>`;
}

function decodeBase64Url(value = '') {
  if (!value) return '';
  let normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  if (pad) {
    normalized += '='.repeat(4 - pad);
  }
  return Buffer.from(normalized, 'base64').toString('utf-8');
}

function getHeaderValue(headers = [], name) {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function escapeHtmlForEmail(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

/** Light server-side hardening before the client runs DOMPurify. */
function sanitizeEmailHtml(html) {
  if (!html || typeof html !== 'string') return '';
  let out = html;
  out = out.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  out = out.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  out = out.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
  out = out.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  out = out.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  out = out.replace(/<embed\b[^>]*>/gi, '');
  out = out.replace(/\son\w+\s*=\s*(["'])[\s\S]*?\1/gi, ' ');
  out = out.replace(/\son\w+\s*=\s*[^\s>'"]+/gi, ' ');
  out = out.replace(/javascript:/gi, '');
  out = out.replace(/data:text\/html/gi, '');
  return out;
}

function collectMimeBodies(payload, htmlParts, plainParts) {
  if (!payload) return;
  if (payload.body?.data && payload.mimeType) {
    const mt = String(payload.mimeType).toLowerCase();
    try {
      const decoded = decodeBase64Url(payload.body.data);
      if (mt === 'text/html' && decoded) htmlParts.push(decoded);
      else if (mt === 'text/plain' && decoded) plainParts.push(decoded);
    } catch (_) {
      // ignore bad base64
    }
  }
  if (payload.parts?.length) {
    for (const part of payload.parts) {
      collectMimeBodies(part, htmlParts, plainParts);
    }
  }
}

/**
 * Full body for thread/conversation view: prefer decoded text/html from MIME tree,
 * else text/plain escaped and wrapped in <pre>.
 */
function extractMessageBodyForDisplay(payload) {
  const htmlParts = [];
  const plainParts = [];
  collectMimeBodies(payload, htmlParts, plainParts);
  if (htmlParts.length) {
    const html = htmlParts.reduce((best, cur) => (cur.length > best.length ? cur : best));
    return { content: sanitizeEmailHtml(html), source: 'html' };
  }
  if (plainParts.length) {
    const plain = plainParts.reduce((best, cur) => (cur.length > best.length ? cur : best));
    const wrapped = `<pre class="email-plain-fallback">${escapeHtmlForEmail(plain)}</pre>`;
    return { content: sanitizeEmailHtml(wrapped), source: 'plain' };
  }
  return { content: '', source: 'none' };
}

/**
 * Index where quoted / previous-thread content starts (earliest match wins).
 */
function findQuotedContentStartIndex(html) {
  if (!html || typeof html !== 'string') return -1;

  const patterns = [
    /<blockquote\b[^>]*\btype\s*=\s*["']cite["'][^>]*>/i,
    /<div\b[^>]*\bgmail_quote_container\b/i,
    /<blockquote\b[^>]*\bclass="[^"]*gmail_quote[^"]*"[^>]*>/i,
    /<div\b[^>]*\bclass="[^"]*gmail_quote[^"]*"[^>]*>/i,
    /<div\b[^>]*\bclass="[^"]*gmail_extra[^"]*"[^>]*>/i,
    /<div\b[^>]*\bclass="[^"]*gmail_attr[^"]*"[^>]*>/i,
    /<div\b[^>]*\bstyle="[^"]*\bborder-top:\s*solid\s*#\s*E1E1E1\b[^"]*"[^>]*>/i,
    /<div\b[^>]*\bstyle='[^']*\bborder-top:\s*solid\s*#\s*E1E1E1\b[^']*'[^>]*>/i,
    /<div\b[^>]*\bstyle="[^"]*border:none;\s*border-top:\s*solid\s*#\s*E1E1E1/i,
    /<br\s*\/?>\s*<blockquote\b/i,
    /\bOn\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^<]{0,200}?\bwrote\s*:/i,
    /<blockquote\b/i,
  ];

  let earliest = -1;
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m.index != null && m.index > 0) {
      if (earliest === -1 || m.index < earliest) {
        earliest = m.index;
      }
    }
  }

  const outlook = html.search(/-----Original Message-----/i);
  if (outlook > 0 && (earliest === -1 || outlook < earliest)) {
    earliest = outlook;
  }

  return earliest;
}

/**
 * Best-effort split: new reply vs quoted thread (Gmail / Outlook / Apple Mail).
 */
function splitMainAndQuotedContent(fullSanitizedHtml) {
  if (!fullSanitizedHtml || typeof fullSanitizedHtml !== 'string') {
    return { contentMain: '', quotedContent: '' };
  }

  const html = fullSanitizedHtml;
  const splitAt = findQuotedContentStartIndex(html);
  if (splitAt > 0) {
    return {
      contentMain: html.slice(0, splitAt).trim(),
      quotedContent: html.slice(splitAt).trim(),
    };
  }

  const preMatch = html.match(/^<pre class="email-plain-fallback">([\s\S]*)<\/pre>$/i);
  if (preMatch) {
    const inner = preMatch[1];
    const plainPatterns = [
      /\n\nOn .+wrote:\s*\n/i,
      /\n\nLe[\s\S]+?a\s+écrit\s*:/i,
      /\n\n-+ ?Original Message ?-+\n/i,
    ];
    for (const pre of plainPatterns) {
      const hit = inner.search(pre);
      if (hit > 0) {
        const mainInner = inner.slice(0, hit).trim();
        const quotedInner = inner.slice(hit).trim();
        return {
          contentMain: sanitizeEmailHtml(
            `<pre class="email-plain-fallback">${mainInner}</pre>`
          ),
          quotedContent: sanitizeEmailHtml(
            `<pre class="email-plain-quoted">${quotedInner}</pre>`
          ),
        };
      }
    }
  }

  return { contentMain: html.trim(), quotedContent: '' };
}

/** Decode common HTML entities for classifier strings. */
function decodeHtmlEntities(text) {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/&#(\d+);/g, (_, code) => {
    const n = Number(code);
    return Number.isFinite(n) && n > 0 && n < 0x10ffff
      ? String.fromCodePoint(n)
      : ' ';
  });
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
    const n = parseInt(hex, 16);
    return Number.isFinite(n) && n > 0 && n < 0x10ffff
      ? String.fromCodePoint(n)
      : ' ';
  });
  const named = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
    hellip: '...',
    mdash: '-',
    ndash: '-',
  };
  s = s.replace(/&([a-z]+);/gi, (m, name) =>
    Object.prototype.hasOwnProperty.call(named, name.toLowerCase())
      ? named[name.toLowerCase()]
      : m
  );
  return s;
}

/** HTML MIME → plain text (keeps line breaks; list items become "- …"). */
function htmlMimeToPlainText(html) {
  if (!html) return '';
  let s = sanitizeEmailHtml(String(html));
  s = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>/gi, '\n');
  s = s.replace(/<\/div>/gi, '\n');
  s = s.replace(/<\/tr>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '\n- ');
  s = s.replace(/<\/li>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(s);
}

/** Strip quoted thread from plain text (after MIME → text). */
function stripQuotedRepliesForClassifier(text) {
  let body = String(text || '');

  if (/<[a-z][^>]*>/i.test(body) || /gmail_quote|blockquote/i.test(body)) {
    const { contentMain } = splitMainAndQuotedContent(
      sanitizeEmailHtml(body)
    );
    body = contentMain ? htmlMimeToPlainText(contentMain) : htmlMimeToPlainText(body);
  }

  const plainPatterns = [
    /\n-{2,}\s*Original Message\s*-{2,}\s*/i,
    /\n-{5,}Original Message-{5,}\s*/i,
    /\n\nOn .+wrote:\s*\n/i,
    /\nOn .+wrote:\s*\n/i,
    /\n\nLe .+ a écrit\s*:\s*\n/i,
    /\n\nLe .+ a écrit\s*:/i,
    /\nFrom:\s*.+\nSent:\s*.+/i,
    /\n_{5,}\s*\n/,
  ];

  for (const re of plainPatterns) {
    const hit = body.search(re);
    if (hit > 0) {
      body = body.slice(0, hit);
      break;
    }
  }

  return body;
}

/** Safety pass: no tags, CSS blocks, or attribute noise. */
function removeRemainingTagsAndCss(text) {
  let s = String(text || '');
  s = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/@[a-z][\s-]*\{[\s\S]*?\}/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/\bclass\s*=\s*["'][^"']*["']/gi, ' ');
  s = s.replace(/\bstyle\s*=\s*["'][^"']*["']/gi, ' ');
  return s;
}

/** One line of prose: no \r\n\t, single spaces only. */
function normalizeClassifierWhitespace(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\r\n\t\f\v]+/g, ' ')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Suggest-reply: keep newlines and "-" bullets; tidy spaces within lines. */
function normalizeSuggestReplyWhitespace(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeClassifierSubject(subject) {
  const decoded = decodeHtmlEntities(String(subject || '').trim());
  return normalizeClassifierWhitespace(decoded) || '(no subject)';
}

/**
 * Oldest message body for classifier:
 * plain MIME or html→text → strip quotes → entities → safety → single-line whitespace.
 */
function extractClassifierContentMain(payload) {
  const htmlParts = [];
  const plainParts = [];
  collectMimeBodies(payload, htmlParts, plainParts);

  let body = '';

  if (plainParts.length) {
    body = plainParts.reduce((best, cur) =>
      cur.length > best.length ? cur : best
    );
    const wrapped = body.match(/^<pre class="email-plain-fallback">([\s\S]*)<\/pre>$/i);
    if (wrapped) {
      body = wrapped[1];
    }
    body = decodeHtmlEntities(body);
  } else if (htmlParts.length) {
    const html = htmlParts.reduce((best, cur) =>
      cur.length > best.length ? cur : best
    );
    body = htmlMimeToPlainText(html);
  }

  body = stripQuotedRepliesForClassifier(body);
  body = decodeHtmlEntities(body);
  body = removeRemainingTagsAndCss(body);
  body = normalizeClassifierWhitespace(body);

  return body;
}

function sortThreadMessagesOldestFirst(messages = []) {
  return [...messages].sort((a, b) => {
    const da = Number(a.internalDate) || 0;
    const db = Number(b.internalDate) || 0;
    return da - db;
  });
}

/**
 * First (oldest) message in a thread as plain text for email classification.
 */
async function getThreadClassifyPayload(adminId, threadId) {
  let thread;
  try {
    thread = await getThread(adminId, threadId);
  } catch (err) {
    const code = err.code || err.response?.status;
    if (code === 404 || code === '404') {
      const notFound = new Error('Thread not found');
      notFound.status = 404;
      throw notFound;
    }
    throw err;
  }

  const tid = thread.id || threadId;
  const messages = thread.messages || [];
  if (!messages.length) {
    const empty = new Error('Thread not found');
    empty.status = 404;
    throw empty;
  }

  const oldest = sortThreadMessagesOldestFirst(messages)[0];
  const headers = oldest.payload?.headers || [];
  const subject = normalizeClassifierSubject(
    getHeaderValue(headers, 'Subject') || '(no subject)'
  );
  const contentMain = extractClassifierContentMain(oldest.payload);
  const from = getHeaderValue(headers, 'From') || '';
  const snippet = oldest.snippet || '';
  const listSnapshot = extractThreadListSnapshot(thread);

  return {
    threadId: tid,
    messageId: oldest.id,
    subject,
    contentMain,
    from,
    snippet,
    listSnapshot,
  };
}

/** Latest-message list row fields from a full Gmail thread object. */
function extractThreadListSnapshot(thread) {
  const tid = thread?.id;
  const sorted = sortThreadMessagesOldestFirst(thread?.messages || []);
  if (!sorted.length) return null;

  const latest = sorted[sorted.length - 1];
  const headers = latest.payload?.headers || [];

  return {
    latestMessageId: latest.id,
    threadId: tid,
    snippet: latest.snippet || '',
    labelIds: latest.labelIds || [],
    from: getHeaderValue(headers, 'From') || '',
    to: getHeaderValue(headers, 'To') || '',
    cc: getHeaderValue(headers, 'Cc') || '',
    subject: getHeaderValue(headers, 'Subject') || '(no subject)',
    date: getHeaderValue(headers, 'Date') || '',
    internalDate:
      latest.internalDate != null ? String(latest.internalDate) : '',
    threadMessageCount: sorted.length,
  };
}

/** Fetch latest-message list snapshot (minimal thread + metadata). */
async function getThreadListSnapshot(adminId, threadId) {
  if (!threadId) return null;
  try {
    const gmail = await getGmailAuth(adminId);
    const threadRes = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'minimal',
    });
    const msgs = threadRes.data.messages || [];
    if (!msgs.length) return null;

    const latest = msgs.reduce((best, cur) => {
      const da = Number(cur.internalDate) || 0;
      const db = Number(best.internalDate) || 0;
      return da >= db ? cur : best;
    });

    const meta = await getMessageListItemMetadata(gmail, latest.id);
    return {
      latestMessageId: meta.id,
      threadId: threadRes.data.id || threadId,
      snippet: meta.snippet || '',
      labelIds: meta.labelIds || [],
      from: meta.from || '',
      to: meta.to || '',
      cc: meta.cc || '',
      subject: meta.subject || '(no subject)',
      date: meta.date || '',
      internalDate: meta.internalDate || '',
      threadMessageCount: msgs.length,
    };
  } catch (err) {
    const code = err.code || err.response?.status;
    if (code === 404 || code === '404') return null;
    throw err;
  }
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Walk MIME parts: Content-ID + attachmentId → map for cid: inlining (inline only, not file_attachment). */
function collectCidAttachmentMap(payload, map = {}) {
  if (!payload) return map;
  const headers = payload.headers || [];
  const cidHeader = headers.find(
    (h) => h.name && h.name.toLowerCase() === 'content-id'
  );
  if (
    cidHeader?.value &&
    payload.body?.attachmentId &&
    !isFileAttachmentPart(payload)
  ) {
    let id = String(cidHeader.value).trim().replace(/^<|>$/g, '');
    if (id) {
      const mimeType = (payload.mimeType || 'application/octet-stream').split(';')[0].trim();
      map[id.toLowerCase()] = {
        attachmentId: payload.body.attachmentId,
        mimeType: mimeType || 'application/octet-stream',
        cidForReplace: id,
      };
    }
  }
  if (payload.parts?.length) {
    for (const p of payload.parts) {
      collectCidAttachmentMap(p, map);
    }
  }
  return map;
}

/**
 * Fetch each distinct inline attachment once (parallel), then applyCidDataUrls
 * rewrites contentMain without duplicate Gmail calls.
 */
async function prefetchCidDataUrls(adminId, messageId, cidMap) {
  const dataUrlByAttachmentId = new Map();
  if (!cidMap || !Object.keys(cidMap).length) return dataUrlByAttachmentId;

  const metaByAttachmentId = new Map();
  for (const meta of Object.values(cidMap)) {
    if (!metaByAttachmentId.has(meta.attachmentId)) {
      metaByAttachmentId.set(meta.attachmentId, meta);
    }
  }

  await Promise.all(
    [...metaByAttachmentId.keys()].map(async (attachmentId) => {
      const meta = metaByAttachmentId.get(attachmentId);
      const mimeType = meta?.mimeType || 'application/octet-stream';
      try {
        const att = await getAttachment(adminId, messageId, attachmentId);
        const b64 = att?.data;
        if (!b64) return;
        let normalized = String(b64).replace(/-/g, '+').replace(/_/g, '/');
        const pad = normalized.length % 4;
        if (pad) normalized += '='.repeat(4 - pad);
        dataUrlByAttachmentId.set(
          attachmentId,
          `data:${mimeType};base64,${normalized}`
        );
      } catch (err) {
        console.warn(
          `[inline cid] skip attachment ${attachmentId} on ${messageId}:`,
          err.message
        );
      }
    })
  );

  return dataUrlByAttachmentId;
}

/** Replace cid:… with pre-fetched data: URLs (sync; no Gmail I/O). */
function applyCidDataUrls(html, cidMap, dataUrlByAttachmentId) {
  if (!html || typeof html !== 'string' || !cidMap || !Object.keys(cidMap).length) {
    return html;
  }
  let out = html;
  for (const meta of Object.values(cidMap)) {
    const dataUrl = dataUrlByAttachmentId.get(meta.attachmentId);
    if (!dataUrl) continue;
    const re = new RegExp(`cid:${escapeRegExp(meta.cidForReplace)}`, 'gi');
    out = out.replace(re, dataUrl);
  }
  return out;
}

const GMAIL_TINY_INLINE_IMAGE_BYTES = 4096;

function getMimePartHeader(headers, headerNameLower) {
  if (!headers || !headerNameLower) return '';
  const h = headers.find(
    (x) => x.name && String(x.name).toLowerCase() === headerNameLower
  );
  return h?.value != null ? String(h.value).trim() : '';
}

/** Strip angle brackets; empty string if none. */
function normalizeContentIdHeaderValue(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const id = raw.trim().replace(/^<|>$/g, '');
  return id || '';
}

/**
 * Parse Content-Disposition primary type and optional filename= / filename*=.
 */
function parseContentDispositionHeader(raw) {
  if (!raw || typeof raw !== 'string') return { type: null, filename: null };
  const v = raw.trim();
  const lower = v.toLowerCase();
  let type = null;
  if (lower.startsWith('inline')) type = 'inline';
  else if (lower.startsWith('attachment')) type = 'attachment';

  let filename = null;
  const fnStar = v.match(/filename\*=(?:UTF-8''|utf-8'')([^;\s]+)/i);
  if (fnStar) {
    try {
      filename = decodeURIComponent(fnStar[1]);
    } catch {
      filename = fnStar[1];
    }
  }
  if (!filename) {
    const quoted = v.match(/filename\s*=\s*"((?:\\.|[^"\\])*)"/i);
    if (quoted) {
      filename = quoted[1].replace(/\\"/g, '"').trim();
    } else {
      const plain = v.match(/filename\s*=\s*([^;\s]+)/i);
      if (plain) filename = plain[1].trim();
    }
  }
  return { type, filename };
}

/**
 * @returns {'file_attachment'|'html_inline'|'decorative_or_tracking'}
 */
function classifyAttachmentForUi(meta) {
  const mime = (meta.mimeType || '').toLowerCase();
  const isImage = mime.startsWith('image/');
  const sz = typeof meta.size === 'number' ? meta.size : 0;
  if (isImage && sz > 0 && sz < GMAIL_TINY_INLINE_IMAGE_BYTES) {
    return 'decorative_or_tracking';
  }
  if (meta.contentDisposition === 'attachment') {
    return 'file_attachment';
  }
  if (meta.contentId || meta.contentDisposition === 'inline') {
    return 'html_inline';
  }
  return 'file_attachment';
}

/** True when part is a regular attachment (not inline cid candidate for HTML). */
function isFileAttachmentPart(part) {
  const headers = part.headers || [];
  const cdRaw = getMimePartHeader(headers, 'content-disposition');
  const parsedCd = parseContentDispositionHeader(cdRaw);
  const contentIdRaw = normalizeContentIdHeaderValue(
    getMimePartHeader(headers, 'content-id')
  );
  const mimeType =
    (part.mimeType || 'application/octet-stream').split(';')[0].trim() ||
    'application/octet-stream';
  const size = typeof part.body?.size === 'number' ? part.body.size : undefined;
  return (
    classifyAttachmentForUi({
      mimeType,
      size,
      contentId: contentIdRaw || null,
      contentDisposition: parsedCd.type,
    }) === 'file_attachment'
  );
}

function buildAttachmentMetaFromPart(part, messageId) {
  const headers = part.headers || [];
  const cdRaw = getMimePartHeader(headers, 'content-disposition');
  const parsedCd = parseContentDispositionHeader(cdRaw);
  const contentIdRaw = normalizeContentIdHeaderValue(
    getMimePartHeader(headers, 'content-id')
  );
  const contentId = contentIdRaw || null;
  const contentIdLookupKey = contentIdRaw ? contentIdRaw.toLowerCase() : null;

  const filenameFromPart =
    part.filename != null && String(part.filename).trim()
      ? String(part.filename).trim()
      : null;
  const filename =
    filenameFromPart ||
    parsedCd.filename ||
    (contentId ? `inline-${contentIdLookupKey.slice(0, 32)}` : null) ||
    'unnamed';

  const mimeType =
    (part.mimeType || 'application/octet-stream').split(';')[0].trim() ||
    'application/octet-stream';
  const size =
    typeof part.body?.size === 'number' ? part.body.size : undefined;

  const contentDisposition = parsedCd.type;

  const attachmentRole = classifyAttachmentForUi({
    mimeType,
    size,
    contentId,
    contentDisposition,
  });

  const base = {
    attachmentId: part.body.attachmentId,
    filename,
    mimeType,
    size,
    attachmentRole,
  };

  if (messageId != null) {
    return { messageId, ...base };
  }
  return base;
}

function extractAttachmentMetaWithMessageId(parts = [], messageId, acc = []) {
  for (const part of parts) {
    if (part.body?.attachmentId) {
      acc.push(buildAttachmentMetaFromPart(part, messageId));
    }
    if (part.parts?.length) {
      extractAttachmentMetaWithMessageId(part.parts, messageId, acc);
    }
  }
  return acc;
}

const ORDER_ATTACHMENT_ROLES = new Set(['file_attachment', 'html_inline']);

/** Attachments from thread messages (inclusive), deduped by filename, order roles only. */
function collectOrderAttachmentsFromMessages(messages = []) {
  const seenFilenames = new Set();
  const attachments = [];

  for (const msg of messages) {
    const messageId = msg.id;
    const metaList = extractAttachmentMetaWithMessageId(
      msg.payload?.parts || [],
      messageId
    );

    for (const meta of metaList) {
      if (!ORDER_ATTACHMENT_ROLES.has(meta.attachmentRole)) continue;

      const filenameKey = String(meta.filename || '')
        .trim()
        .toLowerCase();
      if (!filenameKey || seenFilenames.has(filenameKey)) continue;

      seenFilenames.add(filenameKey);
      attachments.push({
        messageId: meta.messageId,
        attachmentId: meta.attachmentId,
        filename: meta.filename,
        mimeType: meta.mimeType,
        size: meta.size,
        attachmentRole: meta.attachmentRole,
        downloadUrl: `/api/gmail/messages/${meta.messageId}/attachments/${encodeURIComponent(meta.attachmentId)}`,
      });
    }
  }

  return attachments;
}

function sliceThreadMessagesPage(sortedMessages, options = {}) {
  const total = sortedMessages.length;
  const lim = Math.min(Math.max(Number(options.limit) || 10, 1), 50);

  let endExclusive = total;
  if (options.before != null && String(options.before).trim() !== '') {
    const beforeMs = Number(options.before);
    const idx = sortedMessages.findIndex(
      (m) => (Number(m.internalDate) || 0) >= beforeMs
    );
    endExclusive = idx === -1 ? total : idx;
  }

  const start = Math.max(0, endExclusive - lim);
  const chunk = sortedMessages.slice(start, endExclusive);
  const hasMore = start > 0;
  const nextBefore =
    hasMore && chunk.length ? String(chunk[0].internalDate ?? '') : null;

  return { chunk, total, hasMore, nextBefore };
}

async function buildThreadMessageForClient(adminId, msg, threadIdFallback) {
  const headers = msg.payload?.headers || [];
  const messageId = msg.id;
  const attachments = extractAttachmentMetaWithMessageId(
    msg.payload?.parts || [],
    messageId
  );
  const { content: contentRaw } = extractMessageBodyForDisplay(msg.payload);
  const { contentMain: splitMain } = splitMainAndQuotedContent(contentRaw);
  const contentMainRaw =
    splitMain && splitMain.length > 0 ? splitMain : contentRaw;

  const cidMap = collectCidAttachmentMap(msg.payload);
  let contentMain = contentMainRaw;
  if (
    contentMainRaw &&
    /cid:/i.test(contentMainRaw) &&
    Object.keys(cidMap).length > 0
  ) {
    const dataUrlByAttachmentId = await prefetchCidDataUrls(
      adminId,
      messageId,
      cidMap
    );
    contentMain = applyCidDataUrls(
      contentMainRaw,
      cidMap,
      dataUrlByAttachmentId
    );
  }

  return {
    id: messageId,
    threadId: msg.threadId || threadIdFallback,
    snippet: msg.snippet || '',
    subject: getHeaderValue(headers, 'Subject') || '(no subject)',
    from: getHeaderValue(headers, 'From') || '',
    to: getHeaderValue(headers, 'To') || '',
    date: getHeaderValue(headers, 'Date') || '',
    internalDate: msg.internalDate != null ? String(msg.internalDate) : '',
    labelIds: msg.labelIds || [],
    contentMain,
    attachments,
  };
}

async function getThreadMessagesForClient(adminId, threadId) {
  try {
    const gmail = await getGmailAuth(adminId);
    const res = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'minimal',
    });
    const threadMeta = res.data;
    const tid = threadMeta.id || threadId;
    const sorted = sortThreadMessagesOldestFirst(threadMeta.messages || []);

    const messages = await mapWithConcurrency(sorted, 8, async (stub) =>
      getMessageListItemMetadata(gmail, stub.id)
    );

    return {
      id: tid,
      historyId: threadMeta.historyId,
      messages,
      totalMessageCount: messages.length,
    };
  } catch (err) {
    const code = err.code || err.response?.status;
    if (code === 404 || code === '404') {
      const notFound = new Error('Thread not found');
      notFound.status = 404;
      throw notFound;
    }
    throw err;
  }
}

/** Plain prose from display HTML (quotes stripped, no tags). */
function plainTextFromDisplayHtml(html) {
  if (!html) return '';
  let text = htmlMimeToPlainText(String(html));
  text = stripQuotedRepliesForClassifier(text);
  text = removeRemainingTagsAndCss(text);
  return normalizeClassifierWhitespace(text);
}

/** Suggest-reply body: quotes stripped, newlines + "-" preserved. */
function plainTextForSuggestReply(html) {
  if (!html) return '';
  let text = htmlMimeToPlainText(String(html));
  text = stripQuotedRepliesForClassifier(text);
  text = removeRemainingTagsAndCss(text);
  return normalizeSuggestReplyWhitespace(text);
}

function extractEmailAddressFromHeader(fromHeader) {
  if (!fromHeader) return '';
  const m = String(fromHeader).match(/<([^>]+)>/);
  if (m) return m[1].trim().toLowerCase();
  if (/@/.test(fromHeader)) return String(fromHeader).trim().toLowerCase();
  return '';
}

const BUSINESS_OUTBOUND_EMAIL_DOMAINS = ['londonwastemanagement.com'];

function isOutboundFromAddress(fromAddress, businessEmail) {
  const addr = (fromAddress || '').toLowerCase().trim();
  if (!addr) return false;
  if (businessEmail && addr === businessEmail) return true;
  const domain = addr.split('@')[1] || '';
  if (domain.includes('londonwaste')) return true;
  return Boolean(
    domain && BUSINESS_OUTBOUND_EMAIL_DOMAINS.includes(domain)
  );
}

/** Plain-text context from a Gmail API message object (no extra fetch). */
function listPhotoAttachmentsFromGmailMessage(msg) {
  const attachments = extractAttachmentMetaWithMessageId(
    msg?.payload?.parts || [],
    msg?.id
  );
  return attachments.filter((a) => {
    if (!a?.attachmentId) return false;
    const role = a.attachmentRole;
    if (role !== 'file_attachment' && role !== 'html_inline') return false;
    return String(a.mimeType || '')
      .toLowerCase()
      .startsWith('image/');
  });
}

/** Main (non-quoted) HTML body for a Gmail message object. */
function getMessageMainHtml(msg) {
  const { content: contentRaw } = extractMessageBodyForDisplay(msg?.payload);
  const { contentMain: splitMain } = splitMainAndQuotedContent(contentRaw);
  return splitMain && splitMain.length > 0 ? splitMain : contentRaw || '';
}

async function downloadAttachmentBuffer(adminId, messageId, attachmentId) {
  const att = await getAttachment(adminId, messageId, attachmentId);
  const b64 = att?.data;
  if (!b64) return null;

  let normalized = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  if (pad) normalized += '='.repeat(4 - pad);
  return Buffer.from(normalized, 'base64');
}

function plainContextFromGmailMessage(msg) {
  const headers = msg.payload?.headers || [];
  const { content: contentRaw } = extractMessageBodyForDisplay(msg.payload);
  const { contentMain: splitMain } = splitMainAndQuotedContent(contentRaw);
  const mainHtml =
    splitMain && splitMain.length > 0 ? splitMain : contentRaw;
  const contentMain = plainTextForSuggestReply(mainHtml);
  const photoCount = listPhotoAttachmentsFromGmailMessage(msg).length;

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeaderValue(headers, 'From') || '',
    to: getHeaderValue(headers, 'To') || '',
    subject: normalizeClassifierSubject(
      getHeaderValue(headers, 'Subject') || '(no subject)'
    ),
    contentMain,
    photoCount,
    internalDate: msg.internalDate != null ? String(msg.internalDate) : null,
  };
}

async function resolveAdminGmailEmail(adminId) {
  const admin = await Admin.findById(adminId).select('gmailEmailAddress').lean();
  if (admin?.gmailEmailAddress) {
    return String(admin.gmailEmailAddress).trim().toLowerCase();
  }
  try {
    const profile = await getProfile(adminId);
    return String(profile.emailAddress || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

/** Newest message id in thread (by internalDate). */
async function getLatestMessageIdInThread(adminId, threadId) {
  let thread;
  try {
    thread = await getThread(adminId, threadId);
  } catch (err) {
    const code = err.code || err.response?.status;
    if (code === 404 || code === '404') {
      const notFound = new Error('Thread not found');
      notFound.status = 404;
      throw notFound;
    }
    throw err;
  }

  const sorted = sortThreadMessagesOldestFirst(thread.messages || []);
  if (!sorted.length) {
    const notFound = new Error('Thread not found');
    notFound.status = 404;
    throw notFound;
  }

  return sorted[sorted.length - 1].id;
}

function buildSuggestReplyThreadRow(msg, businessEmail) {
  const ctx = plainContextFromGmailMessage(msg);
  const fromAddress = extractEmailAddressFromHeader(ctx.from);
  const direction = isOutboundFromAddress(fromAddress, businessEmail)
    ? 'outbound'
    : 'inbound';

  return {
    direction,
    from_address: fromAddress,
    fromHeader: ctx.from || '',
    subject: ctx.subject,
    contentMain: ctx.contentMain,
    photoCount: ctx.photoCount,
    internalDate: msg.internalDate != null ? String(msg.internalDate) : null,
  };
}

/**
 * Target message + thread rows for suggest-reply (oldest → newest, including target).
 */
async function getSuggestReplyThreadContext(adminId, threadId, messageId) {
  const businessEmail = await resolveAdminGmailEmail(adminId);

  let thread;
  try {
    thread = await getThread(adminId, threadId);
  } catch (err) {
    const code = err.code || err.response?.status;
    if (code === 404 || code === '404') {
      const notFound = new Error('Thread not found');
      notFound.status = 404;
      throw notFound;
    }
    throw err;
  }

  const tid = thread.id || threadId;
  const sorted = sortThreadMessagesOldestFirst(thread.messages || []);
  if (!sorted.length) {
    const notFound = new Error('Thread not found');
    notFound.status = 404;
    throw notFound;
  }

  const targetIndex = sorted.findIndex((m) => m.id === messageId);
  if (targetIndex === -1) {
    const notFound = new Error('Message not found in thread');
    notFound.status = 404;
    throw notFound;
  }

  const target = plainContextFromGmailMessage(sorted[targetIndex]);
  const messagesThroughTarget = sorted.slice(0, targetIndex + 1);
  const threadHistory = messagesThroughTarget.map((msg) =>
    buildSuggestReplyThreadRow(msg, businessEmail)
  );

  return {
    threadId: tid,
    messageId,
    target,
    threadHistory,
    businessEmail,
    messagesThroughTarget,
  };
}

/** Plain-text context for suggest-reply (any message by id). */
async function getMessagePlainContextForSuggest(adminId, messageId) {
  try {
    const gmail = await getGmailAuth(adminId);
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });
    return plainContextFromGmailMessage(res.data);
  } catch (err) {
    const code = err.code || err.response?.status;
    if (code === 404 || code === '404') {
      const notFound = new Error('Message not found');
      notFound.status = 404;
      throw notFound;
    }
    throw err;
  }
}

/** Latest message in a thread: headers + plain-text contentMain. */
async function getThreadLatestMessageForClient(adminId, threadId) {
  const listItem = await getThreadLatestListItem(adminId, threadId);
  if (!listItem) {
    const notFound = new Error('Thread not found');
    notFound.status = 404;
    throw notFound;
  }

  const context = await getMessagePlainContextForSuggest(adminId, listItem.id);
  const tid = listItem.threadId || threadId;

  return {
    ...context,
    threadId: tid,
  };
}

/** Single message body for expand-in-thread UI (contentMain + attachments). */
async function getMessageBodyForClient(adminId, messageId) {
  try {
    const gmail = await getGmailAuth(adminId);
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });
    const msg = res.data;
    const built = await buildThreadMessageForClient(adminId, msg, msg.threadId);
    return {
      id: built.id,
      threadId: built.threadId,
      contentMain: built.contentMain,
      attachments: built.attachments,
    };
  } catch (err) {
    const code = err.code || err.response?.status;
    if (code === 404 || code === '404') {
      const notFound = new Error('Message not found');
      notFound.status = 404;
      throw notFound;
    }
    throw err;
  }
}

async function getThreadFullForClient(adminId, threadId, options = {}) {
  const limit = options.limit;
  const before = options.before;

  let threadMeta;
  try {
    const gmail = await getGmailAuth(adminId);
    const res = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'minimal',
    });
    threadMeta = res.data;

    const tid = threadMeta.id || threadId;
    const sorted = sortThreadMessagesOldestFirst(threadMeta.messages || []);
    const { chunk, total, hasMore, nextBefore } = sliceThreadMessagesPage(
      sorted,
      { limit, before }
    );

    const fullMessages = await mapWithConcurrency(chunk, 6, async (stub) => {
      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: stub.id,
        format: 'full',
      });
      return msgRes.data;
    });

    const messages = await mapWithConcurrency(fullMessages, 6, async (msg) =>
      buildThreadMessageForClient(adminId, msg, tid)
    );

    let quoteItems = [];
    try {
      const ThreadClassification = require('../models/ThreadClassification');
      const classification = await ThreadClassification.findOne({ threadId: tid })
        .select('quoteItems')
        .lean();
      if (classification) {
        quoteItems = (
          Array.isArray(classification.quoteItems)
            ? classification.quoteItems
            : []
        ).map(
          require('./threadQuoteItemsService').formatItemForClient
        );
      }
    } catch (_) {
      // quote fields are optional on full thread
    }

    return {
      id: tid,
      historyId: threadMeta.historyId,
      messages,
      totalMessageCount: total,
      hasMore,
      nextBefore,
      quoteItems,
    };
  } catch (err) {
    const code = err.code || err.response?.status;
    if (code === 404 || code === '404') {
      const notFound = new Error('Thread not found');
      notFound.status = 404;
      throw notFound;
    }
    throw err;
  }
}

function extractMessageContent(payload) {
  if (!payload) return '';

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (!payload.parts?.length) {
    return '';
  }

  // Prefer HTML, fallback to plain text.
  const htmlPart = payload.parts.find((part) => part.mimeType === 'text/html');
  if (htmlPart?.body?.data) {
    return decodeBase64Url(htmlPart.body.data);
  }

  const textPart = payload.parts.find((part) => part.mimeType === 'text/plain');
  if (textPart?.body?.data) {
    return decodeBase64Url(textPart.body.data);
  }

  for (const part of payload.parts) {
    const nested = extractMessageContent(part);
    if (nested) return nested;
  }

  return '';
}

function extractAttachmentMeta(parts = [], acc = []) {
  for (const part of parts) {
    if (part.body?.attachmentId) {
      acc.push(buildAttachmentMetaFromPart(part, null));
    }
    if (part.parts?.length) {
      extractAttachmentMeta(part.parts, acc);
    }
  }
  return acc;
}

function cleanupFiles(files = []) {
  for (const file of files) {
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (error) {
      console.error('Failed to cleanup attachment file:', file.path, error.message);
    }
  }
}

async function sendEmail(adminId, to, subject, text, attachments = []) {
  try {
  const gmail = await getGmailAuth(adminId);
  const admin = await Admin.findById(adminId);

    console.log('Sending email with:', {
      adminId,
      to,
      subject,
      hasAttachments: attachments.length > 0,
      attachmentCount: attachments.length,
      hasSignature: !!admin.emailSignature
    });

    // Get authenticated user email
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const authenticatedEmail = profile.data.emailAddress;

    // Generate a unique Message-ID
    const messageId = `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@${authenticatedEmail.split('@')[1]}>`;

    const boundary = 'boundary_xyz';
    let messageParts = [];

    messageParts.push(`--${boundary}`);
    messageParts.push('Content-Type: text/html; charset="UTF-8"');
    messageParts.push('');
    // Appended signature disabled â€” re-enable: `${text}<br><br>${admin.emailSignature || ''}`
    messageParts.push(`${text}`);

    // Handle attachments
    for (const file of attachments) {
      try {
        console.log('Processing attachment:', {
          filename: file.originalname,
          mimetype: file.mimetype,
          size: file.size
        });

        const content = fs.readFileSync(file.path).toString('base64');
        messageParts.push(`--${boundary}`);
        messageParts.push(`Content-Type: ${file.mimetype}`);
        messageParts.push('Content-Transfer-Encoding: base64');
        messageParts.push(`Content-Disposition: attachment; filename="${file.originalname}"`);
        messageParts.push('');
        messageParts.push(content);
        
        console.log('Attachment processed successfully:', file.originalname);
      } catch (attachmentError) {
        console.error('Error processing attachment:', file.originalname, attachmentError);
        throw new Error(`Failed to process attachment ${file.originalname}: ${attachmentError.message}`);
      }
    }

    messageParts.push(`--${boundary}--`);

    const rawMessage = [
      `From: ${authenticatedEmail}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      `Date: ${new Date().toUTCString()}`,
      `User-Agent: London Waste Management Gmail Integration`,
      `X-Mailer: London Waste Management System`,
      '',
      messageParts.join('\r\n')
    ].join('\r\n');

    console.log('Sending email via Gmail API...');
    console.log('Email details:', {
      from: authenticatedEmail,
      to,
      subject,
      messageId,
      hasAttachments: attachments.length > 0,
      attachmentCount: attachments.length
    });

  const res = await gmail.users.messages.send({
    userId: 'me',
      requestBody: { raw: encodeMessage(rawMessage) },
  });

    console.log('Email sent successfully:', res.data);
  return res.data;
  } catch (error) {
    console.error('Error in sendEmail:', {
      error: error.message,
      stack: error.stack,
      adminId,
      to,
      subject,
      attachmentCount: attachments.length
    });
    throw error;
  }
}

async function fetchEmails(adminId, label = 'INBOX') {
  const gmail = await getGmailAuth(adminId);
  const res = await gmail.users.messages.list({
    userId: 'me',
    labelIds: [label],
    q: 'category:primary',
    maxResults: 20,
  });
  console.log(res.data)
  const messages = res.data.messages || [];
  return Promise.all(messages.map(msg => getEmailById(adminId, msg.id)));
}

async function searchEmails(adminId, query = '') {
  const gmail = await getGmailAuth(adminId);
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 20,
  });

  const messages = res.data.messages || [];
  return Promise.all(messages.map(msg => getEmailById(adminId, msg.id)));
}

/** Gmail `q` for name/email in From, To, or Subject (server-side, no full-body fetch). */
function buildNameSearchGmailQuery(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const token = trimmed.includes(' ') ? `"${escaped}"` : escaped;
  return `(from:${token} OR to:${token} OR subject:${token})`;
}

async function getMessageListItemMetadata(gmail, messageId) {
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'metadata',
    metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Cc'],
  });
  const data = res.data;
  const headers = data.payload?.headers || [];
  return {
    id: data.id,
    threadId: data.threadId,
    snippet: data.snippet || '',
    labelIds: data.labelIds || [],
    internalDate: data.internalDate != null ? String(data.internalDate) : '',
    from: getHeaderValue(headers, 'From') || '',
    to: getHeaderValue(headers, 'To') || '',
    cc: getHeaderValue(headers, 'Cc') || '',
    subject: getHeaderValue(headers, 'Subject') || '(no subject)',
    date: getHeaderValue(headers, 'Date') || '',
  };
}

/** Inbox/list row: metadata only (no content). Always includes threadId + id. */
function formatInboxListMessage(meta, threadMessageCount) {
  const threadId = meta.threadId || meta.id;
  return {
    id: meta.id,
    threadId,
    snippet: meta.snippet || '',
    labelIds: meta.labelIds || [],
    from: meta.from || '',
    to: meta.to || '',
    cc: meta.cc || '',
    subject: meta.subject || '(no subject)',
    date: meta.date || '',
    threadMessageCount: threadMessageCount ?? 1,
  };
}

async function mapWithConcurrency(items, limit, fn) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/**
 * Fast search by name/email in From, To, or Subject (all mail, Gmail `q` + metadata only).
 */
async function searchMessagesByName(adminId, options = {}) {
  const name = String(options.name || options.q || '').trim();
  if (!name) {
    return { messages: [], nextPageToken: null, resultSizeEstimate: 0 };
  }

  const maxResults = Math.min(Math.max(Number(options.maxResults) || 25, 1), 50);
  const gmailQ = buildNameSearchGmailQuery(name);
  const gmail = await getGmailAuth(adminId);

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: gmailQ,
    maxResults,
    pageToken: options.pageToken || undefined,
    includeSpamTrash: options.includeSpamTrash !== false,
  });

  const stubs = listRes.data.messages || [];
  if (!stubs.length) {
    return {
      messages: [],
      nextPageToken: listRes.data.nextPageToken || null,
      resultSizeEstimate: listRes.data.resultSizeEstimate || 0,
      gmailQuery: gmailQ,
    };
  }

  const messages = await mapWithConcurrency(stubs, 8, async (stub) =>
    getMessageListItemMetadata(gmail, stub.id)
  );

  return {
    messages,
    nextPageToken: listRes.data.nextPageToken || null,
    resultSizeEstimate: listRes.data.resultSizeEstimate || 0,
    gmailQuery: gmailQ,
  };
}

async function getEmailById(adminId, messageId) {
  try {
    console.log('getEmailById called with:', { adminId, messageId });
    
  const gmail = await getGmailAuth(adminId);
    // console.log('Gmail auth successful for getEmailById');
    
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

    // console.log('Gmail API response received');
  const data = res.data;
  const headers = data.payload?.headers || [];

  const from = getHeaderValue(headers, 'From');
  const to = getHeaderValue(headers, 'To');
  const cc = getHeaderValue(headers, 'Cc');
  const bcc = getHeaderValue(headers, 'Bcc');
  const subject = getHeaderValue(headers, 'Subject');
  const date = getHeaderValue(headers, 'Date');
    const messageIdHeader = getHeaderValue(headers, 'Message-ID');
  const references = getHeaderValue(headers, 'References');
  const snippet = data.snippet || '';
  const body = extractMessageContent(data.payload);
  const attachments = extractAttachmentMeta(data.payload?.parts || []);

    const result = {
      id: data.id,  // Always use Gmail's internal message ID
    threadId: data.threadId,
    from,
    to,
    subject,
    date,
      cc,
      bcc,
      messageId: messageIdHeader,  // Store the Message-ID header separately
    references,
      snippet,
    content: body,
      attachments,
    labelIds: data.labelIds,
  };
    
    // console.log('Email processed successfully:', { 
    //   id: result.id, 
    //   messageId: result.messageId, 
    //   subject: result.subject 
    // });
    
    return result;
  } catch (error) {
    console.error('Error in getEmailById:', {
      error: error.message,
      stack: error.stack,
      adminId,
      messageId
    });
    throw error;
  }
}

async function findMessageIdByHeaderId(adminId, messageIdHeader) {
  try {
    console.log('Searching for message with Message-ID:', messageIdHeader);
    
    const gmail = await getGmailAuth(adminId);
    
    // Search for the email using the Message-ID header
    const searchQuery = `rfc822msgid:${messageIdHeader}`;
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: searchQuery,
      maxResults: 1,
    });

    if (res.data.messages && res.data.messages.length > 0) {
      const gmailMessageId = res.data.messages[0].id;
      console.log('Found Gmail message ID:', gmailMessageId, 'for Message-ID:', messageIdHeader);
      return gmailMessageId;
    }
    
    console.log('No message found with Message-ID:', messageIdHeader);
    return null;
  } catch (error) {
    console.error('Error in findMessageIdByHeaderId:', {
      error: error.message,
      messageIdHeader
    });
    throw error;
  }
}

async function replyToEmail(
  adminId,
  messageId,
  attachments = [],
  options = {}
) {
  try {
    console.log('=== REPLY EMAIL DEBUG START ===');
    console.log('Input parameters:', {
      adminId,
      messageId,
      attachmentCount: attachments.length,
      options,
    });

    const opts = options && typeof options === 'object' ? options : {};
    const explicitTo =
      typeof opts.to === 'string' && opts.to.trim() ? opts.to.trim() : null;
    const explicitSubject =
      typeof opts.subject === 'string' && opts.subject.trim()
        ? opts.subject.trim()
        : null;
    const explicitContentMain =
      typeof opts.contentMain === 'string' && opts.contentMain.trim()
        ? opts.contentMain.trim()
        : '';
    const explicitContent =
      typeof opts.content === 'string' && opts.content.trim()
        ? opts.content.trim()
        : '';

  const gmail = await getGmailAuth(adminId);
    console.log('Gmail auth successful');
    
  const admin = await Admin.findById(adminId);
    if (!admin) throw new Error('Admin not found');
    console.log('Admin found:', { adminId: admin._id, hasSignature: !!admin.emailSignature });

    // If messageId is a Message-ID header, resolve it to Gmail ID
    let actualMessageId = messageId;
    if (messageId.includes('@')) {
      console.log('Resolving Message-ID to Gmail ID...');
      const gmailId = await findMessageIdByHeaderId(adminId, messageId);
      if (!gmailId) throw new Error(`No Gmail message found with Message-ID: ${messageId}`);
      actualMessageId = gmailId;
      console.log('Resolved to Gmail ID:', actualMessageId);
    }

    // Fetch original email
    console.log('Fetching original email...');
    const original = await getEmailById(adminId, actualMessageId);
    console.log('Original email details:', {
      id: original.id,
      subject: original.subject,
      from: original.from,
      threadId: original.threadId,
      messageId: original.messageId
    });

    // Extract email from `From` header
    let replyToEmail = original.from;
    console.log("Original from field:", replyToEmail);
    const match = replyToEmail.match(/<(.+?)>/);
    if (match) {
      replyToEmail = match[1];
      console.log("Extracted email address:", replyToEmail);
    }

    // Prevent replying to self (only when To is derived from original From)
    console.log('Getting authenticated user profile...');
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const authenticatedEmail = profile.data.emailAddress;
    console.log('Authenticated email:', authenticatedEmail);

    let toHeader;
    if (explicitTo) {
      toHeader = explicitTo;
    } else {
      if (replyToEmail.toLowerCase() === authenticatedEmail.toLowerCase()) {
        throw new Error('Cannot reply to your own email address.');
      }
      toHeader = replyToEmail;
    }

    const subjectLine =
      explicitSubject || `Re: ${original.subject || 'No Subject'}`;

    // Get thread ID and message ID for proper threading
    const threadId = original.threadId;
    const inReplyTo = formatRfcMessageId(original.messageId) || formatRfcMessageId(original.id);
    const referencesChain = [original.references, inReplyTo].filter(Boolean).join(' ').trim();
    console.log('Threading info:', { threadId, inReplyTo, toHeader, subjectLine });

    const htmlContent = explicitContentMain || explicitContent;
    if (!String(htmlContent).trim()) {
      throw new Error('Reply body is empty');
    }
    console.log('Email content prepared, length:', htmlContent.length);

    // Generate a unique Message-ID for this reply
    const newMessageId = `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@${authenticatedEmail.split('@')[1]}>`;

    // Build multipart message if there are attachments
    let raw;
    if (attachments.length > 0) {
      console.log('Building multipart message with attachments...');
      const boundary = 'boundary_xyz';
      let messageParts = [];

      // HTML content part
      messageParts.push(`--${boundary}`);
      messageParts.push('Content-Type: text/html; charset="UTF-8"');
      messageParts.push('');
      messageParts.push(htmlContent);

      // Attachment parts
      for (const file of attachments) {
        try {
          console.log('Processing attachment for reply:', {
            filename: file.originalname,
            mimetype: file.mimetype,
            size: file.size
          });

          const content = fs.readFileSync(file.path).toString('base64');
          messageParts.push(`--${boundary}`);
          messageParts.push(`Content-Type: ${file.mimetype}`);
          messageParts.push('Content-Transfer-Encoding: base64');
          messageParts.push(`Content-Disposition: attachment; filename="${file.originalname}"`);
          messageParts.push('');
          messageParts.push(content);
          
          console.log('Attachment processed successfully for reply:', file.originalname);
        } catch (attachmentError) {
          console.error('Error processing attachment for reply:', file.originalname, attachmentError);
          throw new Error(`Failed to process attachment ${file.originalname}: ${attachmentError.message}`);
        }
      }

      messageParts.push(`--${boundary}--`);

      const replyHeaderLines = [
        `From: ${authenticatedEmail}`,
        `To: ${toHeader}`,
        `Subject: ${subjectLine}`,
        `Message-ID: ${newMessageId}`,
        `In-Reply-To: ${inReplyTo}`,
        `References: ${referencesChain || inReplyTo}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        `Date: ${new Date().toUTCString()}`,
        `User-Agent: London Waste Management Gmail Integration`,
        `X-Mailer: London Waste Management System`,
      ];

      raw = encodeMessage(buildRawMime(replyHeaderLines, messageParts.join('\r\n')));
    } else {
      const replyHeaderLines = [
        `From: ${authenticatedEmail}`,
        `To: ${toHeader}`,
        `Subject: ${subjectLine}`,
        `Message-ID: ${newMessageId}`,
        `In-Reply-To: ${inReplyTo}`,
        `References: ${referencesChain || inReplyTo}`,
        'MIME-Version: 1.0',
        `Content-Type: text/html; charset=UTF-8`,
        `Date: ${new Date().toUTCString()}`,
        `User-Agent: London Waste Management Gmail Integration`,
        `X-Mailer: London Waste Management System`,
      ];

      raw = encodeMessage(buildRawMime(replyHeaderLines, htmlContent));
    }

    console.log('Email details for sending:', {
      to: toHeader,
      subject: subjectLine,
      threadId: threadId,
      newMessageId: newMessageId,
      hasAttachments: attachments.length > 0,
      attachmentCount: attachments.length
    });

    // Send the email
    console.log('Sending reply email via Gmail API...');
  const res = await gmail.users.messages.send({
    userId: 'me',
      requestBody: {
        raw,
        threadId,
      },
  });

    console.log('Gmail API response:', res.data);
    console.log('=== REPLY EMAIL DEBUG END ===');
    return {
      ...res.data,
      threadId,
      subject: subjectLine,
      to: toHeader,
      reply: htmlContent,
    };
  } catch (error) {
    console.error('=== REPLY EMAIL ERROR ===');
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      status: error.status,
      statusCode: error.statusCode,
      response: error.response,
      stack: error.stack
    });
    
    // Log Gmail API specific errors
    if (error.response) {
      console.error('Gmail API Error Response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    
    console.error('=== REPLY EMAIL ERROR END ===');
    throw error;
  } finally {
    cleanupFiles(attachments);
  }
}

async function forwardEmail(adminId, messageId, forwardTo, forwardText, attachments = []) {
  try {
    console.log('=== FORWARD EMAIL DEBUG START ===');
    console.log('Input parameters:', { 
      adminId, 
      messageId, 
      forwardTo, 
      forwardTextLength: forwardText?.length,
      attachmentCount: attachments.length 
    });
    
  const gmail = await getGmailAuth(adminId);
    console.log('Gmail auth successful');
    
  const admin = await Admin.findById(adminId);
    if (!admin) throw new Error('Admin not found');
    console.log('Admin found:', { adminId: admin._id, hasSignature: !!admin.emailSignature });

    // If messageId is a Message-ID header, resolve it to Gmail ID
    let actualMessageId = messageId;
    if (messageId.includes('@')) {
      console.log('Resolving Message-ID to Gmail ID...');
      const gmailId = await findMessageIdByHeaderId(adminId, messageId);
      if (!gmailId) throw new Error(`No Gmail message found with Message-ID: ${messageId}`);
      actualMessageId = gmailId;
      console.log('Resolved to Gmail ID:', actualMessageId);
    }

    // Fetch original email
    console.log('Fetching original email...');
    const original = await getEmailById(adminId, actualMessageId);
    console.log('Original email details:', {
      id: original.id,
      subject: original.subject,
      from: original.from,
      threadId: original.threadId,
      messageId: original.messageId
    });

    // Get authenticated user email
    console.log('Getting authenticated user profile...');
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const authenticatedEmail = profile.data.emailAddress;
    console.log('Authenticated email:', authenticatedEmail);

    // Generate a unique Message-ID for this forward
    const newMessageId = `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@${authenticatedEmail.split('@')[1]}>`;

    // Appended signature disabled â€” re-enable: `${forwardText}<br><br>${admin.emailSignature || ''}`
    const htmlContent = `${forwardText}`;
    console.log('Email content prepared, length:', htmlContent.length);

    // Build multipart message if there are attachments
    let raw;
    if (attachments.length > 0) {
      console.log('Building multipart message with attachments...');
      const boundary = 'boundary_xyz';
      let messageParts = [];

      // HTML content part
      messageParts.push(`--${boundary}`);
      messageParts.push('Content-Type: text/html; charset="UTF-8"');
      messageParts.push('');
      messageParts.push(htmlContent);

      // Attachment parts
      for (const file of attachments) {
        try {
          console.log('Processing attachment for forward:', {
            filename: file.originalname,
            mimetype: file.mimetype,
            size: file.size
          });

          const content = fs.readFileSync(file.path).toString('base64');
          messageParts.push(`--${boundary}`);
          messageParts.push(`Content-Type: ${file.mimetype}`);
          messageParts.push('Content-Transfer-Encoding: base64');
          messageParts.push(`Content-Disposition: attachment; filename="${file.originalname}"`);
          messageParts.push('');
          messageParts.push(content);
          
          console.log('Attachment processed successfully for forward:', file.originalname);
        } catch (attachmentError) {
          console.error('Error processing attachment for forward:', file.originalname, attachmentError);
          throw new Error(`Failed to process attachment ${file.originalname}: ${attachmentError.message}`);
        }
      }

      messageParts.push(`--${boundary}--`);

      const forwardHeaderLines = [
        `From: ${authenticatedEmail}`,
        `To: ${forwardTo}`,
        `Subject: Fwd: ${original.subject || 'No Subject'}`,
        `Message-ID: ${newMessageId}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        `Date: ${new Date().toUTCString()}`,
        `User-Agent: London Waste Management Gmail Integration`,
        `X-Mailer: London Waste Management System`,
      ];

      raw = encodeMessage(buildRawMime(forwardHeaderLines, messageParts.join('\r\n')));
    } else {
      const forwardHeaderLines = [
        `From: ${authenticatedEmail}`,
        `To: ${forwardTo}`,
        `Subject: Fwd: ${original.subject || 'No Subject'}`,
        `Message-ID: ${newMessageId}`,
        'MIME-Version: 1.0',
        `Content-Type: text/html; charset=UTF-8`,
        `Date: ${new Date().toUTCString()}`,
        `User-Agent: London Waste Management Gmail Integration`,
        `X-Mailer: London Waste Management System`,
      ];

      raw = encodeMessage(buildRawMime(forwardHeaderLines, htmlContent));
    }

    console.log('Email details for sending:', {
      to: forwardTo,
      subject: `Fwd: ${original.subject}`,
      newMessageId: newMessageId,
      hasAttachments: attachments.length > 0,
      attachmentCount: attachments.length
    });

    // Send the email
    console.log('Sending forward email via Gmail API...');
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

    console.log('Gmail API response:', res.data);
    console.log('=== FORWARD EMAIL DEBUG END ===');
  return res.data;
  } catch (error) {
    console.error('=== FORWARD EMAIL ERROR ===');
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      status: error.status,
      statusCode: error.statusCode,
      response: error.response,
      stack: error.stack
    });
    
    // Log Gmail API specific errors
    if (error.response) {
      console.error('Gmail API Error Response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    
    console.error('=== FORWARD EMAIL ERROR END ===');
    throw error;
  } finally {
    cleanupFiles(attachments);
  }
}

async function markAsRead(adminId, messageId) {
  const gmail = await getGmailAuth(adminId);
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      removeLabelIds: ['UNREAD'],
    },
  });
}

async function markAsUnread(adminId, messageId) {
  const gmail = await getGmailAuth(adminId);
  return gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      addLabelIds: ['UNREAD'],
    },
  });
}

async function moveToTrash(adminId, messageId) {
  const gmail = await getGmailAuth(adminId);
  await gmail.users.messages.trash({
    userId: 'me',
    id: messageId,
  });
}

async function untrashMessage(adminId, messageId) {
  const gmail = await getGmailAuth(adminId);
  return gmail.users.messages.untrash({
    userId: 'me',
    id: messageId,
  });
}

async function getAttachment(adminId, messageId, attachmentId) {
  const gmail = await getGmailAuth(adminId);
  const attachment = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });
  return attachment.data;
}

async function getThreadLatestListItem(adminId, threadId) {
  if (!threadId) return null;
  try {
    const gmail = await getGmailAuth(adminId);
    const threadRes = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'minimal',
    });
    const msgs = threadRes.data.messages || [];
    if (!msgs.length) return null;

    const latest = msgs.reduce((best, cur) => {
      const da = Number(cur.internalDate) || 0;
      const db = Number(best.internalDate) || 0;
      return da >= db ? cur : best;
    });

    return getMessageListItemMetadata(gmail, latest.id);
  } catch (err) {
    const code = err.code || err.response?.status;
    if (code === 404 || code === '404') return null;
    throw err;
  }
}

async function listMessages(adminId, options = {}) {
  const gmail = await getGmailAuth(adminId);
  const {
    labelIds,
    q,
    maxResults = 20,
    pageToken,
    includeSpamTrash = false,
  } = options;

  const response = await gmail.users.messages.list({
    userId: 'me',
    labelIds,
    q,
    maxResults: Number(maxResults),
    pageToken,
    includeSpamTrash,
  });

  const stubs = response.data.messages || [];
  if (!stubs.length) {
    return {
      messages: [],
      nextPageToken: response.data.nextPageToken || null,
      resultSizeEstimate: response.data.resultSizeEstimate || 0,
    };
  }

  const detailed = await mapWithConcurrency(stubs, 8, async (stub) =>
    getMessageListItemMetadata(gmail, stub.id)
  );

  // Prefer Mongo snapshot counts — avoid N× threads.get (Gmail quota).
  const uniqueThreadIds = [
    ...new Set(detailed.map((m) => m.threadId).filter(Boolean)),
  ];
  const countByThreadId = new Map();
  if (uniqueThreadIds.length) {
    const ThreadClassification = require('../models/ThreadClassification');
    const docs = await ThreadClassification.find({
      threadId: { $in: uniqueThreadIds },
    })
      .select('threadId threadMessageCount')
      .lean();
    for (const doc of docs) {
      const n = Number(doc.threadMessageCount);
      countByThreadId.set(doc.threadId, Number.isFinite(n) && n > 0 ? n : 1);
    }
  }

  const messages = detailed.map((meta) =>
    formatInboxListMessage(
      meta,
      countByThreadId.get(meta.threadId) ?? 1
    )
  );

  return {
    messages,
    nextPageToken: response.data.nextPageToken || null,
    resultSizeEstimate: response.data.resultSizeEstimate || 0,
  };
}

async function batchModifyMessages(adminId, ids = [], addLabelIds = [], removeLabelIds = []) {
  const gmail = await getGmailAuth(adminId);
  return gmail.users.messages.batchModify({
    userId: 'me',
    requestBody: {
      ids,
      addLabelIds,
      removeLabelIds,
    },
  });
}

async function batchDeleteMessages(adminId, ids = []) {
  const gmail = await getGmailAuth(adminId);
  return gmail.users.messages.batchDelete({
    userId: 'me',
    requestBody: { ids },
  });
}

/** In-memory cache for labels.get (unread / totals). Default 10 minutes. */
const LABEL_DETAIL_CACHE_TTL_MS =
  Number(process.env.GMAIL_LABEL_DETAIL_CACHE_TTL_MS) || 10 * 60 * 1000;
const labelDetailCache = new Map();

function labelDetailCacheKey(adminId, labelId) {
  return `${String(adminId)}:${String(labelId)}`;
}

function getCachedLabelDetail(adminId, labelId) {
  const key = labelDetailCacheKey(adminId, labelId);
  const entry = labelDetailCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    labelDetailCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedLabelDetail(adminId, labelId, data) {
  labelDetailCache.set(labelDetailCacheKey(adminId, labelId), {
    data,
    expiresAt: Date.now() + LABEL_DETAIL_CACHE_TTL_MS,
  });
}

function invalidateLabelDetailCache(adminId, labelId = null) {
  const prefix = `${String(adminId)}:`;
  if (labelId != null) {
    labelDetailCache.delete(labelDetailCacheKey(adminId, labelId));
    return;
  }
  for (const key of labelDetailCache.keys()) {
    if (key.startsWith(prefix)) labelDetailCache.delete(key);
  }
}

/**
 * Sidebar: labels.list only (no per-label labels.get — that blows Gmail quota).
 * Counts may be missing; use GET /labels/:id for unread/totals (cached).
 */
async function listLabels(adminId) {
  const gmail = await getGmailAuth(adminId);
  const response = await gmail.users.labels.list({ userId: 'me' });
  return response.data.labels || [];
}

/** Single label with counters; cached to avoid repeated labels.get. */
async function getLabel(adminId, labelId, options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  if (!forceRefresh) {
    const cached = getCachedLabelDetail(adminId, labelId);
    if (cached) return cached;
  }

  const gmail = await getGmailAuth(adminId);
  const response = await gmail.users.labels.get({ userId: 'me', id: labelId });
  const data = response.data;
  setCachedLabelDetail(adminId, labelId, data);
  return data;
}

async function createLabel(adminId, labelBody) {
  const gmail = await getGmailAuth(adminId);
  const response = await gmail.users.labels.create({
    userId: 'me',
    requestBody: labelBody,
  });
  invalidateLabelDetailCache(adminId);
  return response.data;
}

async function updateLabel(adminId, labelId, labelBody) {
  const gmail = await getGmailAuth(adminId);
  const response = await gmail.users.labels.patch({
    userId: 'me',
    id: labelId,
    requestBody: labelBody,
  });
  invalidateLabelDetailCache(adminId, labelId);
  if (response.data) {
    setCachedLabelDetail(adminId, labelId, response.data);
  }
  return response.data;
}

async function deleteLabel(adminId, labelId) {
  const gmail = await getGmailAuth(adminId);
  const result = await gmail.users.labels.delete({ userId: 'me', id: labelId });
  invalidateLabelDetailCache(adminId, labelId);
  return result;
}

async function listThreads(adminId, options = {}) {
  const gmail = await getGmailAuth(adminId);
  const response = await gmail.users.threads.list({
    userId: 'me',
    q: options.q,
    labelIds: options.labelIds,
    maxResults: Number(options.maxResults || 20),
    pageToken: options.pageToken,
  });
  return response.data;
}

/** Message count only; uses minimal format (no bodies). */
async function getThreadMessageCount(adminId, threadId) {
  if (!threadId) return 1;
  try {
    const gmail = await getGmailAuth(adminId);
    const response = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'minimal',
    });
    const n = (response.data.messages || []).length;
    return n > 0 ? n : 1;
  } catch (err) {
    console.warn('[getThreadMessageCount]', threadId, err.message);
    return 1;
  }
}

async function getThread(adminId, threadId) {
  const gmail = await getGmailAuth(adminId);
  const response = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });
  return response.data;
}

async function modifyThread(adminId, threadId, addLabelIds = [], removeLabelIds = []) {
  const gmail = await getGmailAuth(adminId);
  const response = await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: { addLabelIds, removeLabelIds },
  });
  return response.data;
}

async function trashThread(adminId, threadId) {
  const gmail = await getGmailAuth(adminId);
  const response = await gmail.users.threads.trash({
    userId: 'me',
    id: threadId,
  });
  return response.data;
}

async function untrashThread(adminId, threadId) {
  const gmail = await getGmailAuth(adminId);
  const response = await gmail.users.threads.untrash({
    userId: 'me',
    id: threadId,
  });
  return response.data;
}

async function deleteThread(adminId, threadId) {
  const gmail = await getGmailAuth(adminId);
  return gmail.users.threads.delete({
    userId: 'me',
    id: threadId,
  });
}

async function listDrafts(adminId, options = {}) {
  const gmail = await getGmailAuth(adminId);
  const response = await gmail.users.drafts.list({
    userId: 'me',
    maxResults: Number(options.maxResults || 20),
    pageToken: options.pageToken,
  });
  return response.data;
}

async function getDraft(adminId, draftId) {
  const gmail = await getGmailAuth(adminId);
  const response = await gmail.users.drafts.get({
    userId: 'me',
    id: draftId,
    format: 'full',
  });
  return response.data;
}

function buildSimpleRawMessage({ to, subject, text, from }) {
  const raw = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    text,
  ].join('\r\n');
  return encodeMessage(raw);
}

async function createDraft(adminId, { to, subject, text }) {
  const gmail = await getGmailAuth(adminId);
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const raw = buildSimpleRawMessage({
    to,
    subject,
    text,
    from: profile.data.emailAddress,
  });
  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: { raw },
    },
  });
  return response.data;
}

async function updateDraft(adminId, draftId, { to, subject, text }) {
  const gmail = await getGmailAuth(adminId);
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const raw = buildSimpleRawMessage({
    to,
    subject,
    text,
    from: profile.data.emailAddress,
  });
  const response = await gmail.users.drafts.update({
    userId: 'me',
    id: draftId,
    requestBody: {
      id: draftId,
      message: { raw },
    },
  });
  return response.data;
}

async function sendDraft(adminId, draftId) {
  const gmail = await getGmailAuth(adminId);
  const response = await gmail.users.drafts.send({
    userId: 'me',
    requestBody: {
      id: draftId,
    },
  });
  return response.data;
}

async function deleteDraft(adminId, draftId) {
  const gmail = await getGmailAuth(adminId);
  return gmail.users.drafts.delete({ userId: 'me', id: draftId });
}

// Test email function to verify delivery
async function sendTestEmail(adminId, to) {
  try {
    console.log('=== SENDING TEST EMAIL ===');
    const testSubject = `Test Email - ${new Date().toISOString()}`;
    const testText = `
      <h2>Test Email from London Waste Management</h2>
      <p>This is a test email to verify email delivery functionality.</p>
      <p><strong>Sent at:</strong> ${new Date().toLocaleString()}</p>
      <p><strong>Admin ID:</strong> ${adminId}</p>
      <p>If you receive this email, the Gmail integration is working correctly.</p>
    `;

    const result = await sendEmail(adminId, to, testSubject, testText);
    console.log('Test email sent successfully:', result);
    return result;
  } catch (error) {
    console.error('Test email failed:', error);
    throw error;
  }
}

async function getProfile(adminId) {
  const gmail = await getGmailAuth(adminId);
  const response = await gmail.users.getProfile({ userId: 'me' });
  return response.data;
}

function resolveGmailWebhookBatchSize(options = {}) {
  const fromOptions = Number(options.batchSize);
  if (Number.isFinite(fromOptions) && fromOptions > 0) {
    return Math.floor(fromOptions);
  }
  const fromEnv = Number(process.env.GMAIL_WEBHOOK_BATCH_SIZE);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.floor(fromEnv);
  }
  return 10;
}

function resolveGmailWebhookBatchDelayMs(options = {}) {
  const fromOptions = Number(options.batchDelayMs);
  if (Number.isFinite(fromOptions) && fromOptions >= 0) {
    return Math.floor(fromOptions);
  }
  const fromEnv = Number(process.env.GMAIL_WEBHOOK_BATCH_DELAY_MS);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) {
    return Math.floor(fromEnv);
  }
  return 250;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollNewMessages(adminId, options = {}) {
  const batchSize = resolveGmailWebhookBatchSize(options);
  const batchDelayMs = resolveGmailWebhookBatchDelayMs(options);
  const onBatch =
    typeof options.onBatch === 'function' ? options.onBatch : null;

  const admin = await Admin.findById(adminId);
  if (!admin || !admin.gmailTokens) {
    return { newMessages: [], historyId: null };
  }

  const gmail = await getGmailAuth(adminId);

  if (!admin.gmailHistoryId) {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    await Admin.findByIdAndUpdate(adminId, {
      gmailHistoryId: profile.data.historyId,
    });
    return { newMessages: [], historyId: profile.data.historyId };
  }

  const startHistoryId = admin.gmailHistoryId;
  const seenMessageIds = new Set();
  const newMessages = [];
  let pageToken;
  let latestHistoryId = startHistoryId;
  let pageIndex = 0;

  do {
    let historyResponse;
    try {
      historyResponse = await gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded'],
        labelId: 'INBOX',
        maxResults: batchSize,
        pageToken,
      });
    } catch (error) {
      if (error.code === 404) {
        const profile = await gmail.users.getProfile({ userId: 'me' });
        await Admin.findByIdAndUpdate(adminId, {
          gmailHistoryId: profile.data.historyId,
        });
        return { newMessages: [], historyId: profile.data.historyId };
      }
      throw error;
    }

    pageIndex += 1;
    latestHistoryId =
      historyResponse.data.historyId || latestHistoryId;
    pageToken = historyResponse.data.nextPageToken || undefined;

    const histories = historyResponse.data.history || [];
    const pageMessageIds = [];

    for (const entry of histories) {
      const added = entry.messagesAdded || [];
      for (const item of added) {
        const id = item.message?.id;
        if (id && !seenMessageIds.has(id)) {
          seenMessageIds.add(id);
          pageMessageIds.push(id);
        }
      }
    }

    const pageMessages = [];
    for (let i = 0; i < pageMessageIds.length; i += batchSize) {
      const chunkIds = pageMessageIds.slice(i, i + batchSize);
      const chunkMessages = [];

      for (const id of chunkIds) {
        try {
          const message = await getEmailById(adminId, id);
          if ((message.labelIds || []).includes('INBOX')) {
            chunkMessages.push(message);
          }
        } catch (error) {
          console.warn(`Failed to load new message ${id}:`, error.message);
        }
      }

      if (chunkMessages.length) {
        pageMessages.push(...chunkMessages);
        newMessages.push(...chunkMessages);
        if (onBatch) {
          await onBatch(chunkMessages, {
            pageIndex,
            batchSize,
            historyId: latestHistoryId,
          });
        }
      }

      if (
        batchDelayMs > 0 &&
        (i + batchSize < pageMessageIds.length || pageToken)
      ) {
        await sleep(batchDelayMs);
      }
    }

    console.log(
      `[Gmail Sync] admin=${adminId} page=${pageIndex} historyRecords=${histories.length} messages=${pageMessages.length} batchSize=${batchSize}${pageToken ? ' (more pages)' : ''}`
    );

    // Checkpoint progress so a mid-backlog failure can resume without replaying
    // already-processed history records.
    if (histories.length) {
      const lastRecordId = histories[histories.length - 1].id;
      if (lastRecordId != null) {
        await Admin.findByIdAndUpdate(adminId, {
          gmailHistoryId: String(lastRecordId),
        });
      }
    }
  } while (pageToken);

  if (String(latestHistoryId) !== String(startHistoryId)) {
    await Admin.findByIdAndUpdate(adminId, {
      gmailHistoryId: String(latestHistoryId),
    });
  }

  return { newMessages, historyId: latestHistoryId };
}



module.exports = {
  sendEmail,
  getProfile,
  pollNewMessages,
  listMessages,
  fetchEmails,
  searchEmails,
  searchMessagesByName,
  getEmailById,
  findMessageIdByHeaderId,
  replyToEmail,
  forwardEmail,
  markAsRead,
  markAsUnread,
  moveToTrash,
  untrashMessage,
  batchModifyMessages,
  batchDeleteMessages,
  getAttachment,
  listPhotoAttachmentsFromGmailMessage,
  getMessageMainHtml,
  downloadAttachmentBuffer,
  listLabels,
  getLabel,
  createLabel,
  updateLabel,
  deleteLabel,
  listThreads,
  getThread,
  getThreadMessagesForClient,
  getThreadLatestMessageForClient,
  getMessagePlainContextForSuggest,
  getSuggestReplyThreadContext,
  getLatestMessageIdInThread,
  collectOrderAttachmentsFromMessages,
  getMessageBodyForClient,
  getThreadFullForClient,
  getThreadClassifyPayload,
  getThreadListSnapshot,
  extractThreadListSnapshot,
  modifyThread,
  trashThread,
  untrashThread,
  deleteThread,
  listDrafts,
  getDraft,
  createDraft,
  updateDraft,
  sendDraft,
  deleteDraft,
  sendTestEmail,
  getThreadLatestListItem,
  getThreadMessageCount,
  mapWithConcurrency,
};
