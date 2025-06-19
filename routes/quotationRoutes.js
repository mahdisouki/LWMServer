const express = require('express');
const router = express.Router();
const quotationRequestController = require('../controllers/quotationRequestController');
const multer = require('../middlewares/multer');

// Route to create a new quotation request with file uploads
router.post(
    '/quotation',
    multer.array('items'), 
    quotationRequestController.createQuotationRequest
);

// Route to get all quotation requests
router.get('/quotations', quotationRequestController.getAllQuotations);

// Route to get a single quotation request by ID
router.get('/quotation/:id', quotationRequestController.getQuotationById);

// Route to mark a quotation as read
router.patch('/quotation/:id/read', quotationRequestController.markQuotationAsRead);

// Route to mark a quotation as unread
router.patch('/quotation/:id/unread', quotationRequestController.markQuotationAsUnread);

router.post("/sendMovingQuote", multer.array('files'), quotationRequestController.sendMovingServiceEmail);

module.exports = router;
