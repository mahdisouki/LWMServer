const express = require('express');
const router = express.Router();
const refundCtrl = require('../controllers/refundCtrl');

// Direct refund endpoint (admin triggers it manually) - for Stripe/PayPal
router.post('/refund', refundCtrl.processRefund);

// Manual refund endpoint for Cash and Bank Transfer payments
router.post('/refund/manual', refundCtrl.processManualRefund);

module.exports = router;