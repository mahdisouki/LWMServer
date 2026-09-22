const express = require('express');
const router = express.Router();
const mailtoAttributionCtrl = require('../controllers/mailtoAttributionCtrl');

router.post(
  '/attribution/mailto',
  mailtoAttributionCtrl.upsertMailtoLeadHandler,
);

module.exports = router;
