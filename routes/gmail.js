// routes/gmailRoutes.js
const express = require('express');
const router = express.Router();
const gmailCtrl = require('../controllers/gmailCtrl');

// Routes
router.get('/authorize', gmailCtrl.authorize);
router.get('/oauth2callback', gmailCtrl.handleOAuthCallback);
router.post('/send', gmailCtrl.sendEmail);
router.get('/list', gmailCtrl.listEmails);

module.exports = router;
