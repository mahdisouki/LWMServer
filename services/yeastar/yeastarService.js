const axios = require('axios');

const API_PATH = '/openapi/v1.0';
const TOKEN_SKEW_MS = 60 * 1000;

let cachedTokens = null;
let tokenRequest = null;
/** Separate token cache for Linkus SDK AccessID/AccessKey. */
let cachedLinkusTokens = null;
let linkusTokenRequest = null;

function getConfig() {
  const baseUrl = String(process.env.YEASTAR_BASE_URL || 'https://london-waste-management.ukycm.yeastarcloud.com')
    .trim()
    .replace(/\/+$/, '');
  const extension = String(process.env.YEASTAR_EXTENSION || '302').trim();
  const softphoneExtension = String(
    process.env.YEASTAR_SOFTPHONE_EXTENSION || extension,
  ).trim();
  return {
    baseUrl,
    clientId: String(process.env.YEASTAR_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.YEASTAR_CLIENT_SECRET || '').trim(),
    /** Linkus SDK AccessID / AccessKey (Integrations → Linkus SDK), not OpenAPI Client ID. */
    linkusAccessId: String(process.env.YEASTAR_LINKUS_ACCESS_ID || '').trim(),
    linkusAccessKey: String(process.env.YEASTAR_LINKUS_ACCESS_KEY || '').trim(),
    extension,
    extensionName: String(process.env.YEASTAR_EXTENSION_NAME || 'Abdi').trim(),
    softphoneExtension,
  };
}

function isConfigured() {
  const { clientId, clientSecret, baseUrl } = getConfig();
  return Boolean(clientId && clientSecret && baseUrl);
}

function isSoftphoneConfigured() {
  const { linkusAccessId, linkusAccessKey, baseUrl, softphoneExtension } = getConfig();
  return Boolean(linkusAccessId && linkusAccessKey && baseUrl && softphoneExtension);
}

function apiError(message, status, details) {
  const error = new Error(message);
  error.status = status || 502;
  error.details = details;
  return error;
}

function yeastarHeaders() {
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'OpenAPI',
  };
}

async function postToken(path, body) {
  const { baseUrl } = getConfig();
  try {
    const { data } = await axios.post(`${baseUrl}${API_PATH}${path}`, body, {
      headers: yeastarHeaders(),
      timeout: 20000,
    });
    if (!data || Number(data.errcode) !== 0 || !data.access_token) {
      const badLogin = Array.isArray(data?.invalid_param_list)
        && data.invalid_param_list.some((item) => String(item?.field || '').includes('username'));
      const ipBlocked = Number(data?.errcode) === 70004 || data?.errmsg === 'ACCOUNT IP BLOCKED';
      const ipForbidden =
        Number(data?.errcode) === 70087
        || String(data?.errmsg || '').toUpperCase() === 'IP FORBIDDEN';
      let message = data?.errmsg || 'Yeastar rejected the token request';
      let status = 502;
      if (ipForbidden) {
        message =
          'Yeastar rejected this server IP (IP FORBIDDEN). On the PBX: turn off IP Restriction on Integrations → API and Integrations → Linkus SDK (or add this machine’s public IP to the allowlist), and check Security → Security Rules → Blocked IPs.';
        status = 403;
      } else if (ipBlocked) {
        message = 'Yeastar blocked this server IP after failed API logins. In the PBX go to Security > Security Rules > Blocked IPs, delete this IP, then try again.';
        status = 403;
      } else if (badLogin) {
        message = 'Yeastar rejected the Client ID or Client Secret. Copy both again from Integrations / API.';
        status = 406;
      }
      throw apiError(message, status, data);
    }
    const accessTtl = Number(data.access_token_expire_time) || 1800;
    const refreshTtl = Number(data.refresh_token_expire_time) || 86400;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      accessExpiresAt: Date.now() + accessTtl * 1000,
      refreshExpiresAt: Date.now() + refreshTtl * 1000,
    };
  } catch (err) {
    if (err.status) throw err;
    const details = err.response?.data;
    throw apiError(
      details?.errmsg || err.message || 'Yeastar token request failed',
      err.response?.status || 502,
      details,
    );
  }
}

async function requestNewTokens() {
  const { clientId, clientSecret } = getConfig();
  if (!clientId || !clientSecret) {
    throw apiError('Set YEASTAR_CLIENT_ID and YEASTAR_CLIENT_SECRET in the server environment', 503);
  }
  return postToken('/get_token', {
    username: clientId,
    password: clientSecret,
  });
}

async function refreshTokens(refreshToken) {
  return postToken('/refresh_token', { refresh_token: refreshToken });
}

async function ensureAccessToken() {
  if (cachedTokens && cachedTokens.accessExpiresAt > Date.now() + TOKEN_SKEW_MS) {
    return cachedTokens.accessToken;
  }
  if (tokenRequest) return tokenRequest;

  tokenRequest = (async () => {
    try {
      if (cachedTokens?.refreshToken && cachedTokens.refreshExpiresAt > Date.now() + TOKEN_SKEW_MS) {
        try {
          cachedTokens = await refreshTokens(cachedTokens.refreshToken);
          return cachedTokens.accessToken;
        } catch (refreshError) {
          console.error('[Yeastar] refresh failed, requesting a new token:', refreshError.message);
        }
      }
      cachedTokens = await requestNewTokens();
      return cachedTokens.accessToken;
    } finally {
      tokenRequest = null;
    }
  })();

  return tokenRequest;
}

async function yeastarRequest({ method, endpoint, params, data }) {
  const accessToken = await ensureAccessToken();
  const { baseUrl } = getConfig();
  try {
    const response = await axios({
      method,
      url: `${baseUrl}${API_PATH}${endpoint}`,
      params: { ...params, access_token: accessToken },
      data,
      headers: yeastarHeaders(),
      timeout: 20000,
    });
    const body = response.data;
    if (body && body.errcode != null && Number(body.errcode) !== 0) {
      throw apiError(body.errmsg || 'Yeastar request failed', 502, body);
    }
    return body;
  } catch (err) {
    if (err.status) throw err;
    const details = err.response?.data;
    throw apiError(
      details?.errmsg || err.message || 'Yeastar request failed',
      err.response?.status || 502,
      details,
    );
  }
}

async function listExtensions() {
  const body = await yeastarRequest({
    method: 'get',
    endpoint: '/extension/list',
    params: { page: 1, page_size: 100, sort_by: 'number', order_by: 'asc' },
  });
  return {
    total: body.total_number || 0,
    extensions: Array.isArray(body.data) ? body.data : [],
  };
}

async function findConfiguredExtension() {
  const { extension, extensionName } = getConfig();
  const { extensions } = await listExtensions();
  const match = extensions.find((row) => String(row.number) === extension) || null;
  return { extension, extensionName, match };
}

function normalizeCallee(value) {
  const callee = String(value || '').trim();
  if (!/^[0-9+][0-9]{2,20}$/.test(callee)) {
    throw apiError('callee must be a phone or extension number', 400);
  }
  return callee;
}

async function dial({ callee, caller, autoAnswer }) {
  const config = getConfig();
  const from = String(caller || config.extension).trim();
  const to = normalizeCallee(callee);
  const body = await yeastarRequest({
    method: 'post',
    endpoint: '/call/dial',
    data: {
      caller: from,
      callee: to,
      auto_answer: autoAnswer ? 'yes' : 'no',
    },
  });
  return {
    callId: body.call_id || null,
    caller: from,
    callee: to,
    extensionName: from === config.extension ? config.extensionName : null,
  };
}

async function requestLinkusTokens() {
  const { linkusAccessId, linkusAccessKey } = getConfig();
  if (!linkusAccessId || !linkusAccessKey) {
    throw apiError(
      'Set YEASTAR_LINKUS_ACCESS_ID and YEASTAR_LINKUS_ACCESS_KEY from Integrations → Linkus SDK',
      503,
    );
  }
  return postToken('/get_token', {
    username: linkusAccessId,
    password: linkusAccessKey,
  });
}

async function ensureLinkusAccessToken() {
  if (cachedLinkusTokens && cachedLinkusTokens.accessExpiresAt > Date.now() + TOKEN_SKEW_MS) {
    return cachedLinkusTokens.accessToken;
  }
  if (linkusTokenRequest) return linkusTokenRequest;

  linkusTokenRequest = (async () => {
    try {
      if (
        cachedLinkusTokens?.refreshToken &&
        cachedLinkusTokens.refreshExpiresAt > Date.now() + TOKEN_SKEW_MS
      ) {
        try {
          cachedLinkusTokens = await refreshTokens(cachedLinkusTokens.refreshToken);
          return cachedLinkusTokens.accessToken;
        } catch (refreshError) {
          console.error('[Yeastar Linkus] refresh failed:', refreshError.message);
        }
      }
      cachedLinkusTokens = await requestLinkusTokens();
      return cachedLinkusTokens.accessToken;
    } finally {
      linkusTokenRequest = null;
    }
  })();

  return linkusTokenRequest;
}

/**
 * Login signature for ys-webrtc-sdk-core init({ username, secret, pbxURL }).
 * @param {{ extension?: string, expireTime?: number }} [opts]
 */
async function createSoftphoneSession(opts = {}) {
  const config = getConfig();
  if (!isSoftphoneConfigured()) {
    throw apiError(
      'Linkus SDK is not configured. Set YEASTAR_LINKUS_ACCESS_ID and YEASTAR_LINKUS_ACCESS_KEY, then restart.',
      503,
    );
  }

  const username = String(opts.extension || config.softphoneExtension).trim();
  if (!username) {
    throw apiError('softphone extension is required', 400);
  }

  const accessToken = await ensureLinkusAccessToken();
  const { baseUrl } = config;
  const expireTime =
    opts.expireTime === undefined || opts.expireTime === null
      ? Math.floor(Date.now() / 1000) + 3600
      : Number(opts.expireTime);

  let body;
  try {
    const response = await axios.post(
      `${baseUrl}${API_PATH}/sign/create`,
      {
        username,
        sign_type: 'sdk',
        expire_time: Number.isFinite(expireTime) ? expireTime : 0,
      },
      {
        params: { access_token: accessToken },
        headers: yeastarHeaders(),
        timeout: 20000,
      },
    );
    body = response.data;
  } catch (err) {
    const details = err.response?.data;
    throw apiError(
      details?.errmsg || err.message || 'Yeastar sign/create failed',
      err.response?.status || 502,
      details,
    );
  }

  if (!body || Number(body.errcode) !== 0) {
    throw apiError(body?.errmsg || 'Yeastar rejected softphone signature', 502, body);
  }

  const data = body.data;
  const sign =
    (data && typeof data === 'object' && !Array.isArray(data) && data.sign) ||
    (Array.isArray(data) && data[0]?.sign) ||
    null;

  if (!sign) {
    throw apiError('Yeastar sign/create returned no signature', 502, body);
  }

  return {
    username,
    secret: String(sign),
    pbxURL: baseUrl,
    extensionName:
      username === config.extension || username === config.softphoneExtension
        ? config.extensionName
        : null,
    expiresAt: expireTime > 0 ? expireTime : null,
  };
}

module.exports = {
  getConfig,
  isConfigured,
  isSoftphoneConfigured,
  listExtensions,
  findConfiguredExtension,
  dial,
  createSoftphoneSession,
};
