const { google } = require('googleapis');
const Admin = require('../models/Admin');
const {
  encryptGmailTokens,
  decryptGmailTokens,
} = require('../utils/gmailTokenCrypto');

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URL
  );
}

/** Per-request client — avoids credential races when multiple admins use Gmail. */
async function getGmailAuth(adminId) {
  const id = String(adminId);
  const admin = await Admin.findById(id);
  if (!admin || !admin.gmailTokens) throw new Error('No Gmail tokens found');

  const plainTokens = decryptGmailTokens(admin.gmailTokens);
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials(plainTokens);
  oauth2Client.on('tokens', async (tokens) => {
    try {
      const merged = encryptGmailTokens({ ...plainTokens, ...tokens });
      await Admin.findByIdAndUpdate(id, { gmailTokens: merged });
    } catch (error) {
      console.error(`Failed to update tokens for admin ${id}:`, error.message);
    }
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

async function getPeopleAuth(adminId) {
  const id = String(adminId);
  const admin = await Admin.findById(id);
  if (!admin || !admin.gmailTokens) throw new Error('No Google tokens found');

  const plainTokens = decryptGmailTokens(admin.gmailTokens);
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials(plainTokens);
  oauth2Client.on('tokens', async (tokens) => {
    try {
      const merged = encryptGmailTokens({ ...plainTokens, ...tokens });
      await Admin.findByIdAndUpdate(id, { gmailTokens: merged });
    } catch (error) {
      console.error(`Failed to update tokens for admin ${id}:`, error.message);
    }
  });

  return google.people({ version: 'v1', auth: oauth2Client });
}

module.exports = { getGmailAuth, getPeopleAuth };
