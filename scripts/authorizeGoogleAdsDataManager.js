/**
 * Generate a Google OAuth refresh token with Data Manager + Google Ads scopes.
 *
 * 1. Add redirect URI in Google Cloud Console (e.g. http://localhost:3333/oauth2callback)
 * 2. Set GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_OAUTH_REDIRECT_URI in .env
 * 3. node scripts/authorizeGoogleAdsDataManager.js
 * 4. Open the printed URL, sign in, paste the ?code= value when prompted
 * 5. Put the refresh_token in GOOGLE_ADS_REFRESH_TOKEN
 */
require('dotenv').config();
const readline = require('readline');
const { OAuth2Client } = require('google-auth-library');

const SCOPES = [
  'https://www.googleapis.com/auth/datamanager',
  'https://www.googleapis.com/auth/adwords',
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
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI || 'http://localhost:3333/oauth2callback';

  if (!clientId || !clientSecret) {
    console.error('Set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET in .env');
    process.exit(1);
  }

  const client = new OAuth2Client(clientId, clientSecret, redirectUri);
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl);
  console.log('\nAfter approving, copy the full redirect URL (or just the code= value).\n');

  const input = await prompt('Paste redirect URL or code: ');
  const code = input.includes('code=')
    ? new URL(input).searchParams.get('code')
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
  console.log('\nAdd to .env:\nGOOGLE_ADS_REFRESH_TOKEN=' + (tokens.refresh_token || '<paste refresh_token>'));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
