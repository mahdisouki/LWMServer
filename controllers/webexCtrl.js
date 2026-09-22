const crypto = require('crypto');
const Admin = require('../models/Admin');
const webexAuth = require('../services/webex/webexAuthService');

function handleError(res, err, fallback = 'Webex error') {
  let status = err.status || err.statusCode || 500;
  if (status === 401 || status === 403) status = 502;
  console.error('[Webex]', err.message, err.details || '');
  return res.status(status).json({
    success: false,
    message: err.message || fallback,
    details: err.details || undefined,
  });
}

exports.getStatus = async (req, res) => {
  try {
    const admin = await Admin.findById(req.user._id || req.user.id);
    const configured = webexAuth.isConfigured();
    const connected = Boolean(admin?.webexTokens?.access_token);
    return res.json({
      success: true,
      oauthConfigured: configured,
      connected,
      email: admin?.webexEmail || null,
      displayName: admin?.webexDisplayName || null,
      redirectUri: webexAuth.getConfig().redirectUri,
      setupHint: configured
        ? null
        : 'Set WEBEX_CLIENT_ID, WEBEX_CLIENT_SECRET, WEBEX_REDIRECT_URI in server .env (create an Integration on developer.webex.com)',
    });
  } catch (err) {
    return handleError(res, err);
  }
};

exports.getAuthUrl = async (req, res) => {
  try {
    if (!webexAuth.isConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Webex OAuth is not configured on the server',
      });
    }
    const state = crypto.randomBytes(12).toString('hex');
    // Short-lived state in memory is enough for v1; could store on admin
    const url = webexAuth.buildAuthorizeUrl(`${req.user._id || req.user.id}.${state}`);
    return res.json({ success: true, url });
  } catch (err) {
    return handleError(res, err);
  }
};

/** Browser redirect from Webex */
exports.oauthCallback = async (req, res) => {
  const { frontendRedirect } = webexAuth.getConfig();
  try {
    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) {
      return res.redirect(
        `${frontendRedirect}?webex=error&message=${encodeURIComponent(errorDescription || error)}`
      );
    }
    if (!code) {
      return res.redirect(`${frontendRedirect}?webex=error&message=missing_code`);
    }

    const adminId = String(state || '').split('.')[0];
    if (!adminId) {
      return res.redirect(`${frontendRedirect}?webex=error&message=invalid_state`);
    }

    const tokens = await webexAuth.exchangeCodeForTokens(code);
    const me = await webexAuth.getMe(tokens.access_token);

    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.redirect(`${frontendRedirect}?webex=error&message=admin_not_found`);
    }

    admin.webexTokens = tokens;
    admin.webexEmail = me.emails?.[0] || me.email || null;
    admin.webexDisplayName = me.displayName || null;
    await admin.save();

    return res.redirect(`${frontendRedirect}?webex=connected`);
  } catch (err) {
    console.error('[Webex] oauthCallback', err.message);
    return res.redirect(
      `${frontendRedirect}?webex=error&message=${encodeURIComponent(err.message || 'oauth_failed')}`
    );
  }
};

/** Return access token for Calling SDK (refreshed if needed) */
exports.getAccessToken = async (req, res) => {
  try {
    const admin = await Admin.findById(req.user._id || req.user.id);
    if (!admin?.webexTokens?.access_token) {
      return res.status(404).json({
        success: false,
        message: 'Webex is not connected for this admin',
      });
    }

    const tokens = await webexAuth.ensureValidTokens(admin);
    return res.json({
      success: true,
      accessToken: tokens.access_token,
      expiresAt: tokens.expires_at || null,
      email: admin.webexEmail,
      displayName: admin.webexDisplayName,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

/** Dev/test: save a Personal Access Token from developer.webex.com */
exports.savePersonalToken = async (req, res) => {
  try {
    const token = String(req.body?.accessToken || '').trim();
    if (!token) {
      return res.status(400).json({ success: false, message: 'accessToken is required' });
    }

    const me = await webexAuth.getMe(token);
    const admin = await Admin.findById(req.user._id || req.user.id);
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    admin.webexTokens = {
      access_token: token,
      refresh_token: null,
      expires_at: Date.now() + 12 * 60 * 60 * 1000, // PAT typically ~12h
      token_type: 'Bearer',
      scope: 'personal',
    };
    admin.webexEmail = me.emails?.[0] || me.email || null;
    admin.webexDisplayName = me.displayName || null;
    await admin.save();

    return res.json({
      success: true,
      email: admin.webexEmail,
      displayName: admin.webexDisplayName,
      message: 'Personal access token saved. Note: PATs expire; use OAuth for production.',
    });
  } catch (err) {
    return handleError(res, err, 'Invalid Webex token');
  }
};

exports.disconnect = async (req, res) => {
  try {
    const admin = await Admin.findById(req.user._id || req.user.id);
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }
    admin.webexTokens = undefined;
    admin.webexEmail = null;
    admin.webexDisplayName = null;
    await admin.save();
    return res.json({ success: true });
  } catch (err) {
    return handleError(res, err);
  }
};
