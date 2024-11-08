const express = require('express');
const router = express.Router();
const paymentHistoryController = require('../controllers/paymenthisto');

// Route to get all payment histories
router.get('/paymentHistories', paymentHistoryController.getAllPaymentHistories);

// Route to get a specific payment history by ID
router.get('/paymentHistories/:id', paymentHistoryController.getPaymentHistoryById);

module.exports = router;
