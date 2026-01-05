// Google OAuth config (for direct HTTP requests)
const config = {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI,
};

// Also create oauth2Client for backward compatibility with Gmail services
// (Gmail services may still use googleapis)
let oauth2Client = null;
try {
  const { google } = require('googleapis');
  oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );
} catch (e) {
  // googleapis not available, that's okay for calendar-only usage
  console.warn('googleapis not available - Gmail services may not work');
}

// Create a combined export object that works for both Gmail (oauth2Client) and Calendar (config)
const exportObject = oauth2Client || {};

// Add config properties to the exported object
Object.assign(exportObject, config);

// Ensure oauth2Client is available as a property
exportObject.oauth2Client = oauth2Client;

// Export as default (for backward compatibility with Gmail)
module.exports = exportObject;