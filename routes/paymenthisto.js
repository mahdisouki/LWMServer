const express = require('express');
const router = express.Router();
const { getAllPaymentHistories, getPaymentHistoryById, getPaymentHistoryByTaskId } = require('../controllers/paymenthisto');

// Route to get all payment histories
router.get('/paymentHistories', getAllPaymentHistories);

// Route to get a specific payment history by ID
router.get('/paymentHistories/:id', getPaymentHistoryById);

// Route to get payment histories by task ID
router.get('/paymentHistories/task/:taskId', getPaymentHistoryByTaskId);

module.exports = router;
