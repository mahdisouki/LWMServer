const express = require('express');
const router = express.Router();
const bookingHoldCtrl = require('../controllers/bookingHoldCtrl');
const { bookingHoldLimiter, bookingHoldReadLimiter, exitOfferViewLimiter } = require('../middlewares/rateLimiter');

router.post('/exit-popup-view', exitOfferViewLimiter, bookingHoldCtrl.recordExitPopupView);
router.post('/booking-hold', bookingHoldLimiter, bookingHoldCtrl.createBookingHold);
router.get('/booking-hold/eligibility', bookingHoldReadLimiter, bookingHoldCtrl.getClaimEligibility);
router.get('/booking-hold/:id', bookingHoldReadLimiter, bookingHoldCtrl.getBookingHold);

module.exports = router;
