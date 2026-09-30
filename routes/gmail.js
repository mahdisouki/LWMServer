// routes/gmailRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { gmailCtrl, upload, signatureUpload } = require('../controllers/gmailCtrl');
const googleConfig = require('../services/googleClient');
const Admin = require('../models/Admin');
const { isAuth } = require('../middlewares/auth');
const axios = require('axios');
const querystring = require('querystring');

// Generate OAuth URL (no googleapis needed)
router.get('/auth/google', (req, res) => {
  const { adminId } = req.query;
  
  // Validate adminId before redirecting
  if (!adminId) {
    return res.status(400).send('❌ Admin ID is required. Use: /api/gmail/auth/google?adminId=YOUR_ADMIN_ID');
  }
  
  if (!mongoose.Types.ObjectId.isValid(adminId)) {
    return res.status(400).send('❌ Invalid Admin ID format. Please provide a valid MongoDB ObjectId.');
  }
  
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
    state: adminId,
  };
  
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${querystring.stringify(params)}`;
  res.redirect(url);
});

// Handle OAuth callback (no googleapis needed)
router.get('/auth/google/callback', async (req, res) => {
  const { code, state: adminId } = req.query;
  
  // Validate authorization code
  if (!code) {
    return res.status(400).send('❌ No authorization code provided.');
  }
  
  // Validate adminId
  if (!adminId) {
    return res.status(400).send('❌ Admin ID missing from callback. Please try authenticating again.');
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
    
    const tokens = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      scope: response.data.scope,
      token_type: response.data.token_type || 'Bearer',
      expiry_date: Date.now() + (response.data.expires_in * 1000),
    };
    
    // Save tokens to admin
    await Admin.findByIdAndUpdate(adminId, { gmailTokens: tokens });
    
    console.log(`✅ Google tokens saved successfully for admin: ${adminId}`);
    console.log(`✅ Refresh token present: ${!!tokens.refresh_token}`);
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
      <p><strong>Refresh token saved:</strong> ${tokens.refresh_token ? 'Yes ✅' : 'No ⚠️'}</p>
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
          <li>Try authenticating again: <code>/api/gmail/auth/google?adminId=${adminId}</code></li>
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
router.post('/send', isAuth, upload.array('attachments', 10), gmailCtrl.sendEmail);

// Schedule an email to be sent at a future time
router.post('/send/scheduled', isAuth, upload.array('attachments', 10), gmailCtrl.scheduleSend);
router.get('/send/scheduled', isAuth, gmailCtrl.listScheduledEmails);
router.get('/send/scheduled/:id', isAuth, gmailCtrl.getScheduledEmail);
router.patch('/send/scheduled/:id', isAuth, gmailCtrl.rescheduleEmail);
router.delete('/send/scheduled/:id', isAuth, gmailCtrl.cancelScheduledEmail);

// Reply to an email with optional attachments
router.post('/reply', isAuth, upload.array('attachments', 10), gmailCtrl.replyToEmail);

// Outbound reply tracking (admin / ai / ai_edited)
router.get('/replies/stats', isAuth, gmailCtrl.getEmailReplyStats);
router.get('/replies', isAuth, gmailCtrl.listEmailReplies);

// Forward email with optional attachments
router.post('/forward', isAuth, upload.array('attachments', 10), gmailCtrl.forwardEmail);

// Test email endpoint
router.post('/test', isAuth, gmailCtrl.testEmail);

// Compose signatures — one POST: name + title (+ optional profileImage file)
router.get('/settings/signatures', isAuth, gmailCtrl.listMailSignatures);

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
  isAuth,
  handleSignatureUpload,
  gmailCtrl.createMailSignature
);

// AI email categories (Python classifier slugs)
router.get('/categories', isAuth, gmailCtrl.listGmailCategories);

// Messages
router.get('/messages', isAuth, gmailCtrl.listEmails);
router.get('/messages/search/name', isAuth, gmailCtrl.searchEmailsByName);
router.get('/messages/search', isAuth, gmailCtrl.searchEmails);
router.get('/messages/:id/body', isAuth, gmailCtrl.getMessageBody);
router.get('/messages/:id', isAuth, gmailCtrl.getEmail);
router.post('/messages/:id/read', isAuth, gmailCtrl.markAsRead);
router.post('/messages/:id/unread', isAuth, gmailCtrl.markAsUnread);
router.post('/messages/:id/trash', isAuth, gmailCtrl.trashEmail);
router.post('/messages/:id/untrash', isAuth, gmailCtrl.untrashEmail);
router.get('/messages/:id/attachments/:attachmentId', isAuth, gmailCtrl.getAttachment);
router.post('/messages/batch-modify', isAuth, gmailCtrl.batchModify);
router.post('/messages/batch-delete', isAuth, gmailCtrl.batchDelete);

// Render an email as PDF (returns application/pdf, Content-Disposition: attachment).
router.post('/messages/:id/pdf', isAuth, gmailCtrl.downloadEmailPdf);

// Labels
router.get('/labels', isAuth, gmailCtrl.listLabels);
router.get('/labels/:id', isAuth, gmailCtrl.getLabel);
router.post('/labels', isAuth, gmailCtrl.createLabel);
router.patch('/labels/:id', isAuth, gmailCtrl.updateLabel);
router.delete('/labels/:id', isAuth, gmailCtrl.deleteLabel);

// Threads
router.get('/threads', isAuth, gmailCtrl.listThreads);
router.get(
  '/threads/:id/classify-payload',
  isAuth,
  gmailCtrl.getThreadClassifyPayload
);
router.post('/threads/:id/reclassify', isAuth, gmailCtrl.reclassifyThread);
router.get(
  '/threads/:id/latest-message',
  isAuth,
  gmailCtrl.getThreadLatestMessage
);
router.post('/threads/:id/suggest-reply', isAuth, gmailCtrl.suggestReply);
router.post('/threads/:id/llmorder', isAuth, gmailCtrl.llmOrder);
router.get('/threads/:id/quote-items', isAuth, gmailCtrl.getThreadQuoteItems);
router.put('/threads/:id/quote-items', isAuth, gmailCtrl.saveThreadQuoteItems);
router.post(
  '/threads/:id/suggest-reply/test',
  isAuth,
  gmailCtrl.suggestReplyTest
);
router.get('/threads/:id/replies', isAuth, gmailCtrl.listThreadEmailReplies);
router.get('/threads/:id/messages', isAuth, gmailCtrl.getThreadMessages);
router.get('/threads/:id/full', isAuth, gmailCtrl.getThreadFull);
router.get('/threads/:id', isAuth, gmailCtrl.getThread);
router.post('/threads/:id/modify', isAuth, gmailCtrl.modifyThread);
router.post('/threads/:id/trash', isAuth, gmailCtrl.trashThread);
router.post('/threads/:id/untrash', isAuth, gmailCtrl.untrashThread);
router.delete('/threads/:id', isAuth, gmailCtrl.deleteThread);

// Drafts
router.get('/drafts', isAuth, gmailCtrl.listDrafts);
router.get('/drafts/:id', isAuth, gmailCtrl.getDraft);
router.post('/drafts', isAuth, gmailCtrl.createDraft);
router.put('/drafts/:id', isAuth, gmailCtrl.updateDraft);
router.post('/drafts/:id/send', isAuth, gmailCtrl.sendDraft);
router.delete('/drafts/:id', isAuth, gmailCtrl.deleteDraft);

// Contacts (Google People API - Gmail-like recipient suggestions)
router.get('/contacts', isAuth, gmailCtrl.listContacts);

// Pub/Sub push webhook (no auth - Pub/Sub posts here)
router.post('/webhook', gmailCtrl.handleWebhook);

// Watch lifecycle (manual control if needed)
router.post('/watch/start', isAuth, gmailCtrl.startWatch);
router.post('/watch/stop', isAuth, gmailCtrl.stopWatch);

module.exports = router;
