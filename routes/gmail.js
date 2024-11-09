// routes/gmailRoutes.js
const express = require('express');
const router = express.Router();
const gmailCtrl = require('../controllers/gmailCtrl');

// Routes

router.post('/send', gmailCtrl.sendEmail);
router.get('/list', gmailCtrl.listEmails);

module.exports = router;
