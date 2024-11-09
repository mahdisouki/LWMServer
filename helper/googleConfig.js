// googleConfig.js
const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;

const oauth2Client = new OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URL // Example: 'http://localhost:3000/oauth2callback'
);

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];

// Generate an authentication URL
function getAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

// Set the tokens once the user authenticates
async function setCredentials(code) {
  const { tokens } = await oauth2Client.getToken(code);
  
  // Set the refresh token in the OAuth client
  oauth2Client.setCredentials(tokens);

  // Store the refresh token securely if received
  if (tokens.refresh_token) {
    console.log("token exist" , tokens.refresh_token)
    // Save refresh_token in your database or environment securely
    process.env.GOOGLE_REFRESH_TOKEN = tokens.refresh_token;
  }

  return tokens;
}

// Function to ensure oauth2Client always has a valid access token
async function refreshAccessToken() {
  // Set the stored refresh token to the OAuth client if available
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });
    
    // Refresh the access token if expired
    const newToken = await oauth2Client.getAccessToken();
    oauth2Client.setCredentials({ access_token: newToken.token });
  }
}

module.exports = {
  oauth2Client,
  getAuthUrl,
  setCredentials,
  refreshAccessToken,
};
