// routes/gmailRoutes.js
const express = require('express');
const router = express.Router();
const { gmailCtrl, upload } = require('../controllers/gmailCtrl');
const googleConfig = require('../services/googleClient');
const Admin = require('../models/Admin');
const { isAuth } = require('../middlewares/auth');
const axios = require('axios');
const querystring = require('querystring');

// Generate OAuth URL (no googleapis needed)
router.get('/auth/google', (req, res) => {
  const { adminId } = req.query;
  
  const params = {
    client_id: googleConfig.clientId,
    redirect_uri: googleConfig.redirectUri,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar'
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
  
  if (!code) {
    return res.status(400).send('❌ No authorization code provided.');
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
    
    const tokens = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      scope: response.data.scope,
      token_type: response.data.token_type || 'Bearer',
      expiry_date: Date.now() + (response.data.expires_in * 1000),
    };
    
    await Admin.findByIdAndUpdate(adminId, { gmailTokens: tokens });
    res.send('✅ Google account connected successfully with Calendar access.');
  } catch (err) {
    console.error('OAuth callback error:', err.response?.data || err.message);
    res.status(500).send('❌ Failed to connect Google account.');
  }
});
// Send email with optional attachments
router.post('/send', isAuth, upload.array('attachments', 10), gmailCtrl.sendEmail);

// Reply to an email with optional attachments
router.post('/reply', isAuth, upload.array('attachments', 10), gmailCtrl.replyToEmail);

// Forward email with optional attachments
router.post('/forward', isAuth, upload.array('attachments', 10), gmailCtrl.forwardEmail);

// Test email endpoint
router.post('/test', isAuth, gmailCtrl.testEmail);

// Note: Gmail-specific routes (list, search, details, markAsRead, moveToTrash, getAttachments) removed
// These would need to be implemented separately if needed

module.exports = router;
