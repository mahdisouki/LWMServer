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
router.post('/send',isAuth,  gmailCtrl.sendEmail);
router.get('/list',isAuth, gmailCtrl.listEmails);
// Get email details
router.get('/email/:emailId',isAuth,  gmailCtrl.listEmailDetails);

// Reply to an email
router.post('/reply/:emailId',isAuth,  gmailCtrl.replyToEmail);

// Mark an email as read
router.post('/email/:emailId/read',isAuth,  gmailCtrl.markAsRead);
// Search emails
router.get('/search',isAuth,  gmailCtrl.searchEmails);

// Forward email
router.post('/forward/:emailId',isAuth,  gmailCtrl.forwardEmail);

router.post('/moveToTrash',isAuth,  gmailCtrl.moveToTrash);

router.get('/attachments',isAuth,  gmailCtrl.getAttachments);

// Test email endpoint
router.post('/test',isAuth,  gmailCtrl.testEmail);

// New routes with attachment support
router.post('/send-with-attachments', isAuth, upload.array('attachments', 10), gmailCtrl.sendEmailWithAttachments);
router.post('/reply-with-attachments/:emailId', isAuth, upload.array('attachments', 10), gmailCtrl.replyToEmailWithAttachments);
router.post('/forward-with-attachments/:emailId', isAuth, upload.array('attachments', 10), gmailCtrl.forwardEmailWithAttachments);

module.exports = router;
