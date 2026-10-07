const axios = require('axios');
const Admin = require('../models/Admin');
const googleConfig = require('../services/googleClient');
const {
  encryptGmailTokens,
  decryptGmailTokens,
} = require('../utils/gmailTokenCrypto');

/**
 * Get a valid access token for the admin
 * Handles token refresh using direct HTTP requests
 */
async function getAccessToken(adminId) {
  const admin = await Admin.findById(adminId);
  if (!admin || !admin.gmailTokens) {
    throw new Error('No Google tokens found. Please connect your Google account first.');
  }

  // Check if tokens have Calendar scope
  const scope = admin.gmailTokens.scope || '';
  const hasCalendarScope = scope.includes('calendar') || scope.includes('https://www.googleapis.com/auth/calendar');
  
  if (!hasCalendarScope) {
    throw new Error('CALENDAR_SCOPE_MISSING: Please re-authenticate your Google account to grant Calendar permissions. Visit /api/gmail/auth/google?adminId=' + adminId);
  }

  const tokens = decryptGmailTokens(admin.gmailTokens);
  
  // Check if token is expired (with 5 minute buffer)
  const now = Date.now();
  const expiryTime = tokens.expiry_date || 0;
  
  // If token is still valid, return it
  if (expiryTime && now < (expiryTime - 5 * 60 * 1000)) {
    return tokens.access_token;
  }
  
  // Token expired, refresh it using direct HTTP request
  if (!tokens.refresh_token) {
    throw new Error('INVALID_GRANT: No refresh token available. Please re-authenticate.');
  }
  
  try {
    // Refresh token using Google's OAuth2 token endpoint
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: googleConfig.clientId,
      client_secret: googleConfig.clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    
    const newTokens = encryptGmailTokens({
      ...tokens,
      access_token: response.data.access_token,
      expiry_date: Date.now() + (response.data.expires_in * 1000),
    });
    
    // Update tokens in database
    await Admin.findByIdAndUpdate(adminId, { gmailTokens: newTokens });
    
    console.log(`✅ Tokens refreshed for admin ${adminId}`);
    return response.data.access_token;
  } catch (error) {
    console.error('Error refreshing token:', error.response?.data || error.message);
    throw new Error('INVALID_GRANT: Google tokens are invalid. Please re-authenticate.');
  }
}

module.exports = { getAccessToken };

