const { google } = require('googleapis');
const Admin = require('../models/Admin');
const googleClient = require('../services/googleClient');
const oauth2Client = googleClient.oauth2Client || googleClient;

// Increase max listeners to prevent warnings
oauth2Client.setMaxListeners(20);

// Keep track of registered admin IDs to avoid duplicate listeners
const registeredAdmins = new Set();

function registerTokenListener(adminId, existingTokens) {
  const id = String(adminId);
  if (registeredAdmins.has(id)) return;

  oauth2Client.on('tokens', async (tokens) => {
    try {
      await Admin.findByIdAndUpdate(id, {
        gmailTokens: { ...existingTokens, ...tokens },
      });
      console.log(`Tokens updated for admin ${id}`);
    } catch (error) {
      console.error(`Failed to update tokens for admin ${id}:`, error);
    }
  });

  registeredAdmins.add(id);
  console.log(`Event listener registered for admin ${id}`);
}

async function getGmailAuth(adminId) {
  const id = String(adminId);
  const admin = await Admin.findById(id);
  if (!admin || !admin.gmailTokens) throw new Error('No Gmail tokens found');

  oauth2Client.setCredentials(admin.gmailTokens);
  registerTokenListener(id, admin.gmailTokens);

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

async function getPeopleAuth(adminId) {
  const id = String(adminId);
  const admin = await Admin.findById(id);
  if (!admin || !admin.gmailTokens) throw new Error('No Google tokens found');

  oauth2Client.setCredentials(admin.gmailTokens);
  registerTokenListener(id, admin.gmailTokens);

  return google.people({ version: 'v1', auth: oauth2Client });
}

module.exports = { getGmailAuth, getPeopleAuth };
