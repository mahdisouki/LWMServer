const express = require('express');
const router = express.Router();
const couponCtrl = require('../controllers/couponCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const { exitIntentLimiter } = require('../middlewares/rateLimiter');

// Public route: Validate coupon code
router.post('/validate', couponCtrl.validateCoupon);

// Public route: mint a unique single-use exit-intent coupon
router.post('/exit-intent', exitIntentLimiter, couponCtrl.createExitIntentCoupon);

// Admin routes
router.post('/', couponCtrl.createCoupon);
router.get('/search', isAuth, checkRole('Admin'), couponCtrl.searchCouponByName);
router.get('/stats', isAuth, checkRole('Admin'), couponCtrl.getCouponStats);
router.get('/', isAuth, checkRole('Admin'), couponCtrl.getAllCoupons);
router.get('/:id', isAuth, checkRole('Admin'), couponCtrl.getCouponById);
router.put('/:id', isAuth, checkRole('Admin'), couponCtrl.updateCoupon);
router.delete('/:id', isAuth, checkRole('Admin'), couponCtrl.deleteCoupon);


module.exports = router;
