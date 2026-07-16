/**
 * Generate a Google OAuth refresh token for Search Console (Top Search Keywords).
 *
 * 1. In Google Cloud Console, enable "Google Search Console API"
 * 2. Add redirect URI (e.g. http://localhost:3333/oauth2callback) to the OAuth client
 * 3. Set GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET (or GOOGLE_CLIENT_ID / SECRET) in .env
 * 4. Sign in with a Google account that has access to the GSC property
 *    (SEO_GSC_SITE_URL, e.g. sc-domain:londonwastemanagement.com)
 * 5. node scripts/authorizeGoogleSearchConsole.js
 * 6. Open the printed URL, approve, paste the ?code= value when prompted
 * 7. Put the refresh_token in .env as SEO_GSC_REFRESH_TOKEN
 */
require('dotenv').config();
const readline = require('readline');
const { OAuth2Client } = require('google-auth-library');

const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
];

async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI
    || process.env.GOOGLE_OAUTH_REDIRECT_URI
    || process.env.GOOGLE_REDIRECT_URI
    || 'http://localhost:3333/oauth2callback';

  if (!clientId || !clientSecret) {
    console.error('Set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET (or GOOGLE_CLIENT_*) in .env');
    process.exit(1);
  }

  console.log('Using client ID:', clientId.slice(0, 24) + '...');
  console.log('Using redirect URI:', redirectUri);
  console.log('GSC property should be:', process.env.SEO_GSC_SITE_URL || '(not set)');

  const client = new OAuth2Client(clientId, clientSecret, redirectUri);
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl);
  console.log('\nSign in with the Google account that owns/has access to Search Console.');
  console.log('After approving, you may land on a page that fails to load — that is OK.');
  console.log('Copy the full URL from the address bar (it contains ?code=...), or just the code value.\n');

  const input = await prompt('Paste redirect URL or code: ');
  const code = input.includes('code=')
    ? decodeURIComponent((input.match(/[?&]code=([^&]+)/) || [])[1] || '')
    : input;

  if (!code) {
    console.error('No authorization code found.');
    process.exit(1);
  }

  const { tokens } = await client.getToken(code);
  console.log('\n--- Tokens ---');
  console.log('access_token:', tokens.access_token ? '(received)' : '(missing)');
  console.log('refresh_token:', tokens.refresh_token || '(missing — revoke app access and retry with prompt=consent)');
  console.log('scope:', tokens.scope);
  console.log('\nAdd this line to .env:\nSEO_GSC_REFRESH_TOKEN=' + (tokens.refresh_token || '<paste refresh_token>'));
  console.log('\nKeep SEO_GSC_ENABLED=true and SEO_GSC_SITE_URL set to your GSC property.');
  console.log('Then restart the server.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
