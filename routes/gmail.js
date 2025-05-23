// routes/gmailRoutes.js
const express = require('express');
const router = express.Router();
const gmailCtrl = require('../controllers/gmailCtrl');

// Routes

router.post('/send', gmailCtrl.sendEmail);
router.get('/list', gmailCtrl.listEmails);
// Get email details
router.get('/email/:emailId', gmailCtrl.listEmailDetails);

// Reply to an email
router.post('/reply/:emailId', gmailCtrl.replyToEmail);

// Mark an email as read
router.post('/email/:emailId/read', gmailCtrl.markAsRead);

module.exports = router;
