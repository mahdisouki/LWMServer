const { google } = require('googleapis');
const Admin = require('../models/Admin');
const oauth2Client = require('../services/googleClient');

// Increase max listeners to prevent warnings
oauth2Client.setMaxListeners(20);

// Keep track of registered admin IDs to avoid duplicate listeners
const registeredAdmins = new Set();

async function getGmailAuth(adminId) {
  const admin = await Admin.findById(adminId);
  if (!admin || !admin.gmailTokens) throw new Error('No Gmail tokens found');

  oauth2Client.setCredentials(admin.gmailTokens);

  // Only add the event listener once per admin
  if (!registeredAdmins.has(adminId)) {
    oauth2Client.on('tokens', async (tokens) => {
      try {
        await Admin.findByIdAndUpdate(adminId, {
          gmailTokens: { ...admin.gmailTokens, ...tokens },
        });
        console.log(`Tokens updated for admin ${adminId}`);
      } catch (error) {
        console.error(`Failed to update tokens for admin ${adminId}:`, error);
      }
    });
    
    registeredAdmins.add(adminId);
    console.log(`Event listener registered for admin ${adminId}`);
  }

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

module.exports = { getGmailAuth };