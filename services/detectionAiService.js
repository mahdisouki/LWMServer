const axios = require('axios');
const FormData = require('form-data');
const {
  listPhotoAttachmentsFromGmailMessage,
  downloadAttachmentBuffer,
  getMessageMainHtml,
} = require('./gmailService');

const DETECTION_AI_URL =
  process.env.DETECTION_AI_URL || 'https://detectionai.duckdns.org/detect';

const DETECTION_AI_TIMEOUT_MS =
  Number(process.env.DETECTION_AI_TIMEOUT_MS) ;

const DETECTION_AI_CONFIDENCE_THRESHOLD =
  Number(process.env.DETECTION_AI_CONFIDENCE_THRESHOLD) ;

const VIDEO_URL_RE =
  /\.(mp4|mov|avi|mkv|webm|flv|wmv)(?:$|\?)/i;

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function isProbablyVideoUrl(url) {
  const lower = String(url || '').toLowerCase();
  return VIDEO_URL_RE.test(lower) || lower.includes('/video/');
}

/**
 * Quotation / contact emails embed uploaded photos as:
 *   <a href="https://res.cloudinary.com/...">Item 1 - View Image</a>
 * not as Gmail MIME attachments.
 */
function extractUploadedItemImageUrlsFromHtml(html) {
  if (!html || typeof html !== 'string') return [];

  const urls = [];
  const seen = new Set();

  const linkRe =
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  while ((match = linkRe.exec(html)) !== null) {
    const href = decodeHtmlEntities(match[1]).trim();
    const label = String(match[2] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!/^https?:\/\//i.test(href)) continue;
    if (!/view\s+(image|photo)/i.test(label)) continue;
    if (isProbablyVideoUrl(href)) continue;

    const key = href.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(href);
  }

  return urls;
}

function parseDetectionConfidence(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const raw =
    entry.confidence ??
    entry.score ??
    entry.probability ??
    entry.conf;

  if (raw == null || raw === '') return null;

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function extractLabelFromDetectionEntry(entry) {
  if (typeof entry === 'string') return entry.trim();
  if (!entry || typeof entry !== 'object') return '';

  return String(
    entry.label ||
      entry.class ||
      entry.name ||
      entry.item ||
      entry.classe ||
      entry.category ||
      ''
  ).trim();
}

function meetsConfidenceThreshold(confidence) {
  return (
    confidence !== null &&
    confidence >= DETECTION_AI_CONFIDENCE_THRESHOLD
  );
}

function extractDetectionsFromResponse(data) {
  if (!data || typeof data !== 'object') return [];

  const entries = Array.isArray(data.detections) ? data.detections : [];

  return entries
    .map((entry) => {
      const label = extractLabelFromDetectionEntry(entry);
      const confidence = parseDetectionConfidence(entry);
      if (!label || confidence === null) return null;

      return {
        label,
        confidence,
        accepted: meetsConfidenceThreshold(confidence),
      };
    })
    .filter(Boolean);
}

function extractLabelsFromDetectionResponse(data) {
  return extractDetectionsFromResponse(data)
    .filter((entry) => entry.accepted)
    .map((entry) => entry.label);
}

function addLabelsToCountMap(countMap, labels) {
  for (const label of labels) {
    const key = String(label || '').trim();
    if (!key) continue;
    countMap.set(key, (countMap.get(key) || 0) + 1);
  }
}

function countMapToItems(countMap) {
  return [...countMap.entries()].map(([name, count]) => ({ name, count }));
}

async function detectItemsInImageBuffer(buffer, filename, mimeType) {
  const form = new FormData();
  form.append('image', buffer, {
    filename: filename || 'photo.jpg',
    contentType: mimeType || 'image/jpeg',
  });

  const res = await axios.post(DETECTION_AI_URL, form, {
    headers: form.getHeaders(),
    timeout: DETECTION_AI_TIMEOUT_MS,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  const detections = extractDetectionsFromResponse(res.data);
  const labels = detections
    .filter((entry) => entry.accepted)
    .map((entry) => entry.label);

  return { labels, count: labels.length, detections };
}

async function downloadImageFromUrl(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: DETECTION_AI_TIMEOUT_MS,
    maxContentLength: 25 * 1024 * 1024,
    maxBodyLength: 25 * 1024 * 1024,
  });

  const buffer = Buffer.from(res.data);
  const mimeType = String(
    res.headers['content-type'] || 'image/jpeg'
  )
    .split(';')[0]
    .trim();

  let filename = 'uploaded-item.jpg';
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split('/').pop();
    if (base) filename = decodeURIComponent(base);
  } catch {
    // keep default
  }

  return { buffer, mimeType, filename };
}

/**
 * Run detection on:
 * 1) Gmail MIME image attachments
 * 2) Quotation / contact "View Image" HTML links (Cloudinary etc.)
 *
 * Returns { labels, items, imageCount }.
 */
async function detectItemsFromGmailMessage(adminId, gmailMessage) {
  const empty = {
    labels: [],
    items: [],
    imageCount: 0,
  };

  if (!gmailMessage?.id) return empty;

  const photos = listPhotoAttachmentsFromGmailMessage(gmailMessage);
  const mainHtml = getMessageMainHtml(gmailMessage);
  const uploadedUrls = extractUploadedItemImageUrlsFromHtml(mainHtml);
  const imageCount = photos.length + uploadedUrls.length;

  if (!imageCount) {
    return empty;
  }

  const countMap = new Map();
  const imageResults = [];

  for (const photo of photos) {
    try {
      const buffer = await downloadAttachmentBuffer(
        adminId,
        gmailMessage.id,
        photo.attachmentId
      );
      if (!buffer?.length) {
        continue;
      }

      const result = await detectItemsInImageBuffer(
        buffer,
        photo.filename,
        photo.mimeType
      );
      addLabelsToCountMap(countMap, result.labels);
      imageResults.push({
        source: 'attachment',
        filename: photo.filename,
        detections: result.detections,
      });
    } catch (err) {
      imageResults.push({
        source: 'attachment',
        filename: photo.filename,
        error: err.response?.data || err.message,
      });
    }
  }

  for (const url of uploadedUrls) {
    try {
      const { buffer, mimeType, filename } = await downloadImageFromUrl(url);
      if (!buffer?.length) {
        continue;
      }
      if (!String(mimeType).toLowerCase().startsWith('image/')) {
        continue;
      }

      const result = await detectItemsInImageBuffer(buffer, filename, mimeType);
      addLabelsToCountMap(countMap, result.labels);
      imageResults.push({
        source: 'viewImageLink',
        filename,
        url,
        detections: result.detections,
      });
    } catch (err) {
      imageResults.push({
        source: 'viewImageLink',
        url,
        error: err.response?.data || err.message,
      });
    }
  }

  const items = countMapToItems(countMap);
  const labels = items.map((item) => item.name);

  console.log('[Detection AI]', {
    messageId: gmailMessage.id,
    threshold: DETECTION_AI_CONFIDENCE_THRESHOLD,
    images: imageResults,
  });

  return { labels, items, imageCount };
}

module.exports = {
  detectItemsInImageBuffer,
  detectItemsFromGmailMessage,
  extractLabelsFromDetectionResponse,
  extractUploadedItemImageUrlsFromHtml,
  downloadImageFromUrl,
};
