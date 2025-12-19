const express = require('express');
const router = express.Router();
const quotationRequestController = require('../controllers/quotationRequestController');
const multer = require('../middlewares/multer');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
// Route to create a new quotation request with file uploads
router.post(
    '/quotation',
    multer.array('items'), 
    quotationRequestController.createQuotationRequest
);

// Route to get all quotation requests
router.get('/quotations', isAuth, checkRole('Admin'), quotationRequestController.getAllQuotations);

// Route to get a single quotation request by ID
router.get('/quotation/:id', isAuth, checkRole('Admin'), quotationRequestController.getQuotationById);

// Route to mark a quotation as read
router.patch('/quotation/:id/read', isAuth, checkRole('Admin'), quotationRequestController.markQuotationAsRead);

// Route to mark a quotation as unread
router.patch('/quotation/:id/unread', isAuth, checkRole('Admin'), quotationRequestController.markQuotationAsUnread);

router.post("/sendMovingQuote", isAuth, checkRole('Admin'), multer.array('files'), quotationRequestController.sendMovingServiceEmail);

module.exports = router;
