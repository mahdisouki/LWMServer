const axios = require('axios');

const AUTH_URL = 'https://webexapis.com/v1/authorize';
const TOKEN_URL = 'https://webexapis.com/v1/access_token';
const PEOPLE_ME_URL = 'https://webexapis.com/v1/people/me';

/** Scopes for Webex Calling softphone (adjust in Control Hub / Integration if needed) */
const DEFAULT_SCOPES = [
  'spark:kms',
  'spark:people_read',
  'spark:devices_read',
  'spark:devices_write',
  'spark:calls_read',
  'spark:calls_write',
].join(' ');

function getConfig() {
  return {
    clientId: process.env.WEBEX_CLIENT_ID || '',
    clientSecret: process.env.WEBEX_CLIENT_SECRET || '',
    redirectUri:
      process.env.WEBEX_REDIRECT_URI ||
      'http://localhost:3000/api/webex/oauth/callback',
    frontendRedirect:
      process.env.WEBEX_FRONTEND_REDIRECT ||
      'http://localhost:5173/dashboard/webex',
    scopes: process.env.WEBEX_SCOPES || DEFAULT_SCOPES,
  };
}

function isConfigured() {
  const { clientId, clientSecret } = getConfig();
  return Boolean(clientId && clientSecret);
}

function buildAuthorizeUrl(state) {
  const { clientId, redirectUri, scopes } = getConfig();
  if (!clientId) {
    const err = new Error('WEBEX_CLIENT_ID is not configured');
    err.status = 503;
    throw err;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: scopes,
    state: state || 'lwm',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, redirectUri } = getConfig();
  if (!clientId || !clientSecret) {
    const err = new Error('Webex OAuth is not configured');
    err.status = 503;
    throw err;
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  try {
    const { data } = await axios.post(TOKEN_URL, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return normalizeTokenResponse(data);
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error_description || err.message;
    const error = new Error(msg || 'Failed to exchange Webex auth code');
    error.status = err.response?.status || 502;
    error.details = err.response?.data;
    throw error;
  }
}

async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = getConfig();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  try {
    const { data } = await axios.post(TOKEN_URL, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return normalizeTokenResponse(data);
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error_description || err.message;
    const error = new Error(msg || 'Failed to refresh Webex token');
    error.status = err.response?.status || 502;
    error.details = err.response?.data;
    throw error;
  }
}

function normalizeTokenResponse(data = {}) {
  const expiresIn = Number(data.expires_in) || 3600;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    token_type: data.token_type || 'Bearer',
    scope: data.scope || '',
    expires_at: Date.now() + expiresIn * 1000,
  };
}

async function getMe(accessToken) {
  const { data } = await axios.get(PEOPLE_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

/**
 * Ensure admin has a valid access token; refresh if needed.
 */
async function ensureValidTokens(admin) {
  if (!admin?.webexTokens?.access_token) {
    return null;
  }

  const expiresAt = Number(admin.webexTokens.expires_at) || 0;
  const stillValid = expiresAt > Date.now() + 60 * 1000;

  if (stillValid) {
    return admin.webexTokens;
  }

  if (!admin.webexTokens.refresh_token || !isConfigured()) {
    return admin.webexTokens; // may be PAT without refresh — return as-is
  }

  const refreshed = await refreshAccessToken(admin.webexTokens.refresh_token);
  admin.webexTokens = {
    ...admin.webexTokens.toObject?.() || admin.webexTokens,
    ...refreshed,
    refresh_token: refreshed.refresh_token || admin.webexTokens.refresh_token,
  };
  await admin.save();
  return admin.webexTokens;
}

module.exports = {
  getConfig,
  isConfigured,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getMe,
  ensureValidTokens,
  DEFAULT_SCOPES,
};
