// routes/gmailRoutes.js
const express = require('express');
const router = express.Router();
const { gmailCtrl, upload } = require('../controllers/gmailCtrl');
const oauth2Client = require('../services/googleClient');
const Admin = require('../models/Admin');
const { isAuth } = require('../middlewares/auth');
// Routes
router.get('/auth/google', (req, res) => {
    const { adminId } = req.query;
  
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/gmail.modify'],
      state: adminId,
    });
  
    res.redirect(url);
  });
  
  router.get('/auth/google/callback', async (req, res) => {
    const { code, state: adminId } = req.query;
  
    try {
      const { tokens } = await oauth2Client.getToken(code);
      await Admin.findByIdAndUpdate(adminId, { gmailTokens: tokens });
      res.send('✅ Gmail connected successfully.');
    } catch (err) {
      console.error(err);
      res.status(500).send('❌ Failed to connect Gmail.');
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
