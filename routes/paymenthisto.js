const express = require('express');
const router = express.Router();
const {getAllPaymentHistories , getPaymentHistoryById} = require('../controllers/paymenthisto');

// Route to get all payment histories
router.get('/paymentHistories',getAllPaymentHistories);

// Route to get a specific payment history by ID
router.get('/paymentHistories/:id',getPaymentHistoryById);

module.exports = router;
