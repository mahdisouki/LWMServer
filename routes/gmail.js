// routes/gmailRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { gmailCtrl, upload, signatureUpload } = require('../controllers/gmailCtrl');
const googleConfig = require('../services/googleClient');
const Admin = require('../models/Admin');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const querystring = require('querystring');
const { encryptGmailTokens } = require('../utils/gmailTokenCrypto');

const requireAdmin = [isAuth, checkRole('Admin')];

// Generate OAuth URL — logged-in Admin only; state is signed (adminId + nonce) and expires
router.get('/auth/google', ...requireAdmin, (req, res) => {
  const adminId = req.user._id;
  const state = jwt.sign(
    { adminId: String(adminId), nonce: crypto.randomBytes(16).toString('hex') },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );

  const params = {
    client_id: googleConfig.clientId,
    redirect_uri: googleConfig.redirectUri,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.labels',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.settings.basic',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/contacts.readonly',
      'https://www.googleapis.com/auth/contacts.other.readonly'
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  };
  
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${querystring.stringify(params)}`;
  // Return URL as JSON so the authenticated SPA can open Google (redirect would drop the bearer token)
  res.json({ url });
});

// Handle OAuth callback (no googleapis needed)
router.get('/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  
  // Validate authorization code
  if (!code) {
    return res.status(400).send('❌ No authorization code provided.');
  }

  let adminId;
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET);
    adminId = payload.adminId;
    if (!adminId || !payload.nonce) {
      throw new Error('Invalid state payload');
    }
  } catch (err) {
    return res.status(400).send('❌ Invalid or expired OAuth state. Please authenticate again while logged in as Admin.');
  }
  
  // Validate ObjectId format to prevent truncation errors
  if (!mongoose.Types.ObjectId.isValid(adminId)) {
    console.error('❌ Invalid adminId format received:', adminId);
    return res.status(400).send(`
      ❌ Invalid Admin ID format: "${adminId}"<br/>
      The ID appears to be truncated or invalid.<br/>
      Please try authenticating again with a valid Admin ID.
    `);
  }
  
  // Verify admin exists before proceeding
  const admin = await Admin.findById(adminId);
  if (!admin) {
    return res.status(404).send(`❌ Admin with ID "${adminId}" not found.`);
  }
  
  try {
    // Exchange code for tokens using direct HTTP request
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      code: code,
      client_id: googleConfig.clientId,
      client_secret: googleConfig.clientSecret,
      redirect_uri: googleConfig.redirectUri,
      grant_type: 'authorization_code',
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    
    // Validate that we received tokens
    if (!response.data.access_token) {
      throw new Error('No access token received from Google');
    }
    
    if (!response.data.refresh_token) {
      console.warn('⚠️ No refresh token received. This may require re-authentication later.');
    }
    
    const tokens = encryptGmailTokens({
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      scope: response.data.scope,
      token_type: response.data.token_type || 'Bearer',
      expiry_date: Date.now() + (response.data.expires_in * 1000),
    });
    
    // Save encrypted tokens to admin
    await Admin.findByIdAndUpdate(adminId, { gmailTokens: tokens });
    
    console.log(`✅ Google tokens saved successfully for admin: ${adminId}`);
    console.log(`✅ Refresh token present: ${!!response.data.refresh_token}`);
    console.log(`✅ Token expires at: ${new Date(tokens.expiry_date).toISOString()}`);

    // Auto-start Gmail watch (Pub/Sub push) if topic is configured
    if (process.env.GMAIL_PUBSUB_TOPIC) {
      try {
        const { startWatch } = require('../services/gmailWatchService');
        await startWatch(adminId);
        console.log(`✅ Gmail watch started for admin ${adminId}`);
      } catch (watchError) {
        console.error(
          `⚠️ Failed to start Gmail watch for admin ${adminId}:`,
          watchError.message
        );
      }
    }
    
    res.send(`
      <h2>✅ Google account connected successfully!</h2>
      <p>Your Google Calendar and Gmail access has been configured.</p>
      <p><strong>Admin ID:</strong> ${adminId}</p>
      <p><strong>Refresh token saved:</strong> ${response.data.refresh_token ? 'Yes ✅' : 'No ⚠️'}</p>
      <p>You can now close this window. The tokens will be automatically refreshed when needed.</p>
    `);
  } catch (err) {
    console.error('OAuth callback error:', err.response?.data || err.message);
    
    // More specific error handling
    if (err.response?.data?.error === 'invalid_grant') {
      const errorDescription = err.response.data.error_description || 'Unknown error';
      return res.status(400).send(`
        <h2>❌ Authentication Failed</h2>
        <p><strong>Error:</strong> invalid_grant</p>
        <p><strong>Details:</strong> ${errorDescription}</p>
        <hr/>
        <h3>Possible causes:</h3>
        <ul>
          <li>Authorization code expired (try authenticating again)</li>
          <li>Redirect URI doesn't match Google Cloud Console settings</li>
          <li>OAuth credentials (CLIENT_ID/SECRET) are incorrect</li>
          <li>Authorization code was already used</li>
        </ul>
        <h3>How to fix:</h3>
        <ol>
          <li>Check your <code>.env</code> file has correct <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code></li>
          <li>Verify <code>GOOGLE_REDIRECT_URI</code> matches exactly in Google Cloud Console</li>
          <li>Try authenticating again: <code>GET /api/gmail/auth/google</code> (logged-in Admin)</li>
        </ol>
      `);
    }
    
    if (err.response?.status === 400) {
      return res.status(400).send(`
        <h2>❌ Bad Request</h2>
        <p>Google returned a 400 error. Check your OAuth configuration.</p>
        <p><strong>Error:</strong> ${JSON.stringify(err.response?.data || err.message)}</p>
      `);
    }
    
    res.status(500).send(`
      <h2>❌ Failed to connect Google account</h2>
      <p>An unexpected error occurred. Please try again.</p>
      <p><strong>Error:</strong> ${err.message}</p>
    `);
  }
});
// Send email with optional attachments
router.post('/send', ...requireAdmin, upload.array('attachments', 10), gmailCtrl.sendEmail);

// Schedule an email to be sent at a future time
router.post('/send/scheduled', ...requireAdmin, upload.array('attachments', 10), gmailCtrl.scheduleSend);
router.get('/send/scheduled', ...requireAdmin, gmailCtrl.listScheduledEmails);
router.get('/send/scheduled/:id', ...requireAdmin, gmailCtrl.getScheduledEmail);
router.patch('/send/scheduled/:id', ...requireAdmin, gmailCtrl.rescheduleEmail);
router.delete('/send/scheduled/:id', ...requireAdmin, gmailCtrl.cancelScheduledEmail);

// Reply to an email with optional attachments
router.post('/reply', ...requireAdmin, upload.array('attachments', 10), gmailCtrl.replyToEmail);

// Outbound reply tracking (admin / ai / ai_edited)
router.get('/replies/stats', ...requireAdmin, gmailCtrl.getEmailReplyStats);
router.get('/replies', ...requireAdmin, gmailCtrl.listEmailReplies);

// Forward email with optional attachments
router.post('/forward', ...requireAdmin, upload.array('attachments', 10), gmailCtrl.forwardEmail);

// Test email endpoint
router.post('/test', ...requireAdmin, gmailCtrl.testEmail);

// Compose signatures — one POST: name + title (+ optional profileImage file)
router.get('/settings/signatures', ...requireAdmin, gmailCtrl.listMailSignatures);

function handleSignatureUpload(req, res, next) {
  signatureUpload.single('profileImage')(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'Invalid profile image upload',
        error: err.message,
      });
    }
    next();
  });
}

router.post(
  '/settings/signatures',
  ...requireAdmin,
  handleSignatureUpload,
  gmailCtrl.createMailSignature
);

// AI email categories (Python classifier slugs)
router.get('/categories', ...requireAdmin, gmailCtrl.listGmailCategories);

// Messages
router.get('/messages', ...requireAdmin, gmailCtrl.listEmails);
router.get('/messages/search/name', ...requireAdmin, gmailCtrl.searchEmailsByName);
router.get('/messages/search', ...requireAdmin, gmailCtrl.searchEmails);
router.get('/messages/:id/body', ...requireAdmin, gmailCtrl.getMessageBody);
router.get('/messages/:id', ...requireAdmin, gmailCtrl.getEmail);
router.post('/messages/:id/read', ...requireAdmin, gmailCtrl.markAsRead);
router.post('/messages/:id/unread', ...requireAdmin, gmailCtrl.markAsUnread);
router.post('/messages/:id/trash', ...requireAdmin, gmailCtrl.trashEmail);
router.post('/messages/:id/untrash', ...requireAdmin, gmailCtrl.untrashEmail);
router.get('/messages/:id/attachments/:attachmentId', ...requireAdmin, gmailCtrl.getAttachment);
router.post('/messages/batch-modify', ...requireAdmin, gmailCtrl.batchModify);
router.post('/messages/batch-delete', ...requireAdmin, gmailCtrl.batchDelete);

// Render an email as PDF (returns application/pdf, Content-Disposition: attachment).
router.post('/messages/:id/pdf', ...requireAdmin, gmailCtrl.downloadEmailPdf);

// Labels
router.get('/labels', ...requireAdmin, gmailCtrl.listLabels);
router.get('/labels/:id', ...requireAdmin, gmailCtrl.getLabel);
router.post('/labels', ...requireAdmin, gmailCtrl.createLabel);
router.patch('/labels/:id', ...requireAdmin, gmailCtrl.updateLabel);
router.delete('/labels/:id', ...requireAdmin, gmailCtrl.deleteLabel);

// Threads
router.get('/threads', ...requireAdmin, gmailCtrl.listThreads);
router.get(
  '/threads/:id/classify-payload',
  ...requireAdmin,
  gmailCtrl.getThreadClassifyPayload
);
router.post('/threads/:id/reclassify', ...requireAdmin, gmailCtrl.reclassifyThread);
router.get(
  '/threads/:id/latest-message',
  ...requireAdmin,
  gmailCtrl.getThreadLatestMessage
);
router.post('/threads/:id/suggest-reply', ...requireAdmin, gmailCtrl.suggestReply);
router.post('/threads/:id/llmorder', ...requireAdmin, gmailCtrl.llmOrder);
router.get('/threads/:id/quote-items', ...requireAdmin, gmailCtrl.getThreadQuoteItems);
router.put('/threads/:id/quote-items', ...requireAdmin, gmailCtrl.saveThreadQuoteItems);
router.post(
  '/threads/:id/suggest-reply/test',
  ...requireAdmin,
  gmailCtrl.suggestReplyTest
);
router.get('/threads/:id/replies', ...requireAdmin, gmailCtrl.listThreadEmailReplies);
router.get('/threads/:id/messages', ...requireAdmin, gmailCtrl.getThreadMessages);
router.get('/threads/:id/full', ...requireAdmin, gmailCtrl.getThreadFull);
router.get('/threads/:id', ...requireAdmin, gmailCtrl.getThread);
router.post('/threads/:id/modify', ...requireAdmin, gmailCtrl.modifyThread);
router.post('/threads/:id/trash', ...requireAdmin, gmailCtrl.trashThread);
router.post('/threads/:id/untrash', ...requireAdmin, gmailCtrl.untrashThread);
router.delete('/threads/:id', ...requireAdmin, gmailCtrl.deleteThread);

// Drafts
router.get('/drafts', ...requireAdmin, gmailCtrl.listDrafts);
router.get('/drafts/:id', ...requireAdmin, gmailCtrl.getDraft);
router.post('/drafts', ...requireAdmin, gmailCtrl.createDraft);
router.put('/drafts/:id', ...requireAdmin, gmailCtrl.updateDraft);
router.post('/drafts/:id/send', ...requireAdmin, gmailCtrl.sendDraft);
router.delete('/drafts/:id', ...requireAdmin, gmailCtrl.deleteDraft);

// Contacts (Google People API - Gmail-like recipient suggestions)
router.get('/contacts', ...requireAdmin, gmailCtrl.listContacts);

// Pub/Sub push webhook — secret path required (set same URL in Google Pub/Sub subscription)
router.post('/webhook/:secret', gmailCtrl.handleWebhook);
router.post('/webhook', (_req, res) => res.status(401).send('Unauthorized'));

// Watch lifecycle (manual control if needed)
router.post('/watch/start', ...requireAdmin, gmailCtrl.startWatch);
router.post('/watch/stop', ...requireAdmin, gmailCtrl.stopWatch);

// My inbox assignment (push / active pool)
const gmailAssignmentCtrl = require('../controllers/gmailAssignmentCtrl');
router.get('/assignments/presence', ...requireAdmin, gmailAssignmentCtrl.listAdminPresence);
router.get('/assignments/status', ...requireAdmin, gmailAssignmentCtrl.getMyAssignmentStatus);
router.put('/assignments/active', ...requireAdmin, gmailAssignmentCtrl.setMyAssignmentActive);
router.post('/assignments/activity', ...requireAdmin, gmailAssignmentCtrl.recordActivity);
router.post(
  '/assignments/:threadId/reassign',
  ...requireAdmin,
  gmailAssignmentCtrl.reassign
);

module.exports = router;
