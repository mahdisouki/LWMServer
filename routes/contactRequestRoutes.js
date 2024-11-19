// routes/contactRequestRoutes.js
const express = require('express');
const router = express.Router();
const contactRequestController = require('../controllers/contactRequestController');

router.post('/contact', contactRequestController.createContactRequest);
router.get('/contact', contactRequestController.getAllContactRequests); // Get all contact requests
router.get('/contact/:id', contactRequestController.getContactRequestById); // Get contact request by ID

module.exports = router;
