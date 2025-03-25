const express = require('express');
const router = express.Router();
const refundCtrl = require('../controllers/refundCtrl');

// Direct refund endpoint (admin triggers it manually)
router.post('/refund', refundCtrl.processRefund);

module.exports = router;