// routes/gmailRoutes.js
const express = require('express');
const router = express.Router();
const gmailCtrl = require('../controllers/gmailCtrl');
const { isAuth } = require('../middlewares/auth');

// Routes

router.post('/send',isAuth, gmailCtrl.sendEmail);
router.get('/list',isAuth, gmailCtrl.listEmails);
// Get email details
router.get('/email/:emailId',isAuth, gmailCtrl.listEmailDetails);

// Reply to an email
router.post('/reply/:emailId',isAuth, gmailCtrl.replyToEmail);

// Mark an email as read
router.post('/email/:emailId/read', isAuth, gmailCtrl.markAsRead);

module.exports = router;
