const express = require('express');
const router = express.Router();
const quotationRequestController = require('../controllers/quotationRequestController');
const multer = require('../middlewares/multer');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const { formLimiter } = require('../middlewares/rateLimiter');
// Route to create a new quotation request with file uploads
router.post(
    '/quotation',
    formLimiter, // Add rate limiting
    multer.array('items'),
    quotationRequestController.createQuotationRequest
);

// Route to get all quotation requests
router.get('/quotations', quotationRequestController.getAllQuotations);

// Route to get a single quotation request by ID
router.get('/quotation/:id', isAuth, checkRole('Admin'), quotationRequestController.getQuotationById);

// Route to mark a quotation as read
router.patch('/quotation/:id/read', isAuth, checkRole('Admin'), quotationRequestController.markQuotationAsRead);

// Route to mark a quotation as unread
router.patch('/quotation/:id/unread', isAuth, checkRole('Admin'), quotationRequestController.markQuotationAsUnread);

// Route to update quotation (e.g., set reason)
router.patch('/quotation/:id', isAuth, checkRole('Admin'), quotationRequestController.updateQuotation);

router.post("/sendMovingQuote", formLimiter, multer.array('files'), quotationRequestController.sendMovingServiceEmail);

router.post("/sendBusinessQuote", formLimiter, quotationRequestController.sendBusinessQuoteEmail);

router.post("/sendRecruitment", formLimiter, multer.single('cv'), quotationRequestController.sendRecruitmentEmail);

module.exports = router;
