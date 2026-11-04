const axios = require('axios');

const API_PATH = '/openapi/v1.0';
const TOKEN_SKEW_MS = 60 * 1000;

let cachedTokens = null;
let tokenRequest = null;

function getConfig() {
  const baseUrl = String(process.env.YEASTAR_BASE_URL || 'https://london-waste-management.ukycm.yeastarcloud.com')
    .trim()
    .replace(/\/+$/, '');
  return {
    baseUrl,
    clientId: String(process.env.YEASTAR_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.YEASTAR_CLIENT_SECRET || '').trim(),
    extension: String(process.env.YEASTAR_EXTENSION || '302').trim(),
    extensionName: String(process.env.YEASTAR_EXTENSION_NAME || 'Abdi').trim(),
  };
}

function isConfigured() {
  const { clientId, clientSecret, baseUrl } = getConfig();
  return Boolean(clientId && clientSecret && baseUrl);
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
      let message = data?.errmsg || 'Yeastar rejected the token request';
      let status = 502;
      if (ipBlocked) {
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

module.exports = {
  getConfig,
  isConfigured,
  listExtensions,
  findConfiguredExtension,
  dial,
};
