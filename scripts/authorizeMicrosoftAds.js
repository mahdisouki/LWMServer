/**
 * One-time OAuth to get a Microsoft Ads refresh token.
 *
 * Prerequisites in .env:
 *   MICROSOFT_ADS_CLIENT_ID
 *   MICROSOFT_ADS_CLIENT_SECRET
 *   MICROSOFT_ADS_OAUTH_REDIRECT_URI=http://localhost:3333/oauth2callback
 *
 * IMPORTANT: Sign in with a Microsoft Advertising user that uses
 * "Microsoft account" sign-in (NOT Google). Ads → Settings → User management
 * shows "Signs in with". Google-linked users cause IdentityTypeMismatch (126).
 *
 * Usage:
 *   node scripts/authorizeMicrosoftAds.js
 */
require('dotenv').config();
const http = require('http');
const { URL } = require('url');
const axios = require('axios');

const SCOPES = ['https://ads.microsoft.com/msads.manage', 'offline_access'];
const AUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0';

async function main() {
  const clientId = process.env.MICROSOFT_ADS_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_ADS_CLIENT_SECRET;
  const redirectUri =
    process.env.MICROSOFT_ADS_OAUTH_REDIRECT_URI || 'http://localhost:3333/oauth2callback';

  if (!clientId || !clientSecret) {
    console.error('Set MICROSOFT_ADS_CLIENT_ID and MICROSOFT_ADS_CLIENT_SECRET in .env');
    process.exit(1);
  }

  const redirect = new URL(redirectUri);
  if (redirect.hostname !== 'localhost' && redirect.hostname !== '127.0.0.1') {
    console.error('This script expects a localhost redirect URI for the local listener.');
    process.exit(1);
  }

  const port = Number(redirect.port || 80);
  const callbackPath = redirect.pathname || '/oauth2callback';

  const authUrl = new URL(`${AUTH_BASE}/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('scope', SCOPES.join(' '));
  authUrl.searchParams.set('prompt', 'select_account');

  console.log('Using client ID:', `${clientId.slice(0, 8)}...`);
  console.log('Using redirect URI:', redirectUri);
  console.log('\nOpen this URL — sign in as a Microsoft-account Ads user (not Google):\n');
  console.log(authUrl.toString());
  console.log('\nWaiting for redirect on', redirectUri, '...\n');

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://localhost:${port}`);
        if (reqUrl.pathname !== callbackPath) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const error = reqUrl.searchParams.get('error');
        if (error) {
          const desc = reqUrl.searchParams.get('error_description') || error;
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end(`OAuth error: ${desc}`);
          server.close();
          reject(new Error(desc));
          return;
        }

        const authCode = reqUrl.searchParams.get('code');
        if (!authCode) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing code');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Microsoft Ads authorized</h1><p>You can close this tab and return to the terminal.</p>');
        server.close();
        resolve(authCode);
      } catch (err) {
        server.close();
        reject(err);
      }
    });

    server.listen(port, '127.0.0.1');
    server.on('error', reject);
  });

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: SCOPES.join(' '),
  });

  const { data } = await axios.post(`${AUTH_BASE}/token`, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  console.log('--- Tokens ---');
  console.log('access_token:', data.access_token ? '(received)' : '(missing)');
  console.log('refresh_token:', data.refresh_token || '(missing — retry with prompt=consent)');
  console.log('scope:', data.scope);
  console.log('\nAdd these to backend .env:\n');
  console.log('MICROSOFT_ADS_CONVERSIONS_ENABLED=false');
  console.log('MICROSOFT_ADS_DEVELOPER_TOKEN=<your developer token>');
  console.log('MICROSOFT_ADS_CUSTOMER_ID=254949450');
  console.log('MICROSOFT_ADS_ACCOUNT_ID=187266347');
  console.log(`MICROSOFT_ADS_CLIENT_ID=${clientId}`);
  console.log('MICROSOFT_ADS_CLIENT_SECRET=<already set>');
  console.log(`MICROSOFT_ADS_OAUTH_REDIRECT_URI=${redirectUri}`);
  console.log(`MICROSOFT_ADS_REFRESH_TOKEN=${data.refresh_token || '<missing>'}`);
  console.log('MICROSOFT_ADS_OFFLINE_CONVERSION_NAME=quote-to-purchase');
  console.log('\nKeep ENABLED=false until a test upload succeeds, then set true.');
}

main().catch((error) => {
  console.error('Failed:', error.response?.data || error.message);
  process.exit(1);
});
