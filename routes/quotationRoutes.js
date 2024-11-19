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

module.exports = router;
