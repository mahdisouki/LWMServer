const crypto = require('crypto');

const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${API_VERSION}`;

async function httpFetch(url, options) {
  if (typeof fetch === 'function') {
    return fetch(url, options);
  }
  const { default: nodeFetch } = await import('node-fetch');
  return nodeFetch(url, options);
}

function getConfig() {
  return {
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    apiVersion: API_VERSION,
  };
}

function assertConfigured() {
  const { token, phoneNumberId } = getConfig();
  if (!token || !phoneNumberId) {
    const err = new Error('WhatsApp is not configured (missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID)');
    err.status = 503;
    throw err;
  }
}

function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
}

function verifyWebhookSignature(rawBody, signatureHeader) {
  const { appSecret } = getConfig();
  if (!appSecret) {
    // Allow local/dev if secret not set yet
    return true;
  }
  if (!signatureHeader || !rawBody) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(String(signatureHeader))
    );
  } catch {
    return false;
  }
}

async function graphRequest(path, { method = 'GET', body, formData } = {}) {
  assertConfigured();
  const { token } = getConfig();
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;

  const headers = {
    Authorization: `Bearer ${token}`,
  };

  let payload;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await httpFetch(url, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      `WhatsApp API error (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.details = data;
    throw err;
  }

  return data;
}

async function sendTextMessage(to, text) {
  const { phoneNumberId } = getConfig();
  const toPhone = normalizePhone(to);
  return graphRequest(`/${phoneNumberId}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toPhone,
      type: 'text',
      text: { preview_url: true, body: String(text || '') },
    },
  });
}

async function sendTemplateMessage(to, templateName, languageCode = 'en_US', components = []) {
  const { phoneNumberId } = getConfig();
  const toPhone = normalizePhone(to);
  const body = {
    messaging_product: 'whatsapp',
    to: toPhone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
    },
  };
  if (components?.length) {
    body.template.components = components;
  }
  return graphRequest(`/${phoneNumberId}/messages`, {
    method: 'POST',
    body,
  });
}

async function sendMediaMessage(to, { type, mediaId, link, caption, filename }) {
  const { phoneNumberId } = getConfig();
  const toPhone = normalizePhone(to);
  const mediaPayload = {};
  if (mediaId) mediaPayload.id = mediaId;
  if (link) mediaPayload.link = link;
  if (caption && ['image', 'video', 'document'].includes(type)) {
    mediaPayload.caption = caption;
  }
  if (filename && type === 'document') {
    mediaPayload.filename = filename;
  }

  return graphRequest(`/${phoneNumberId}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toPhone,
      type,
      [type]: mediaPayload,
    },
  });
}

async function markMessageAsRead(waMessageId) {
  const { phoneNumberId } = getConfig();
  return graphRequest(`/${phoneNumberId}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: waMessageId,
    },
  });
}

async function getMediaMeta(mediaId) {
  return graphRequest(`/${mediaId}`);
}

async function downloadMedia(mediaId) {
  const meta = await getMediaMeta(mediaId);
  if (!meta?.url) {
    const err = new Error('Media URL not found');
    err.status = 404;
    throw err;
  }

  assertConfigured();
  const { token } = getConfig();
  const res = await httpFetch(meta.url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = new Error(`Failed to download media (${res.status})`);
    err.status = res.status;
    throw err;
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: meta.mime_type || res.headers.get('content-type') || 'application/octet-stream',
    fileSize: meta.file_size,
    sha256: meta.sha256,
  };
}

async function uploadMedia(buffer, mimeType, filename = 'file') {
  assertConfigured();
  const { token, phoneNumberId } = getConfig();
  const FormData = require('form-data');
  const axios = require('axios');

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', buffer, {
    filename: filename || 'file',
    contentType: mimeType,
  });

  try {
    const res = await axios.post(
      `${GRAPH_BASE}/${phoneNumberId}/media`,
      form,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    );
    return res.data; // { id: '...' }
  } catch (err) {
    const data = err.response?.data;
    const msg = data?.error?.message || err.message || 'Failed to upload media';
    const error = new Error(msg);
    error.status = err.response?.status || 500;
    error.details = data;
    throw error;
  }
}

function mimeToWhatsAppType(mimeType = '') {
  const mime = String(mimeType).toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

async function listMessageTemplates() {
  assertConfigured();
  const { businessAccountId } = getConfig();
  if (!businessAccountId) {
    const err = new Error('WHATSAPP_BUSINESS_ACCOUNT_ID is not configured');
    err.status = 503;
    throw err;
  }
  return graphRequest(
    `/${businessAccountId}/message_templates?limit=100&fields=name,status,language,category,components`
  );
}

function looksLikeTemporaryToken(token) {
  // Meta temporary tokens from API Setup are usually short-lived EAAG... tokens;
  // we cannot perfectly detect permanence, so we only hint based on env flag.
  if (!token) return true;
  if (String(process.env.WHATSAPP_TOKEN_PERMANENT || '').toLowerCase() === 'true') {
    return false;
  }
  return true;
}

module.exports = {
  getConfig,
  assertConfigured,
  normalizePhone,
  verifyWebhookSignature,
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  markMessageAsRead,
  getMediaMeta,
  downloadMedia,
  uploadMedia,
  mimeToWhatsAppType,
  listMessageTemplates,
  looksLikeTemporaryToken,
  graphRequest,
};
