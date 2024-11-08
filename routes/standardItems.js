const express = require('express');
const router = express.Router();
const standardItemCtrl = require('../controllers/standardItemCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role')
const multer = require('../middlewares/multer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

router.post('/item', isAuth, checkRole('Admin'), multer.single('image'), standardItemCtrl.createStandardItem);
router.get('/standard', standardItemCtrl.getAllStandardItems);
router.get('/category/:category', standardItemCtrl.getItemsByCategory); 
router.get('/:id', standardItemCtrl.getStandardItemById);
router.put('/:id', isAuth, checkRole('Admin'), multer.single('image'), standardItemCtrl.updateStandardItem);
router.delete('/:id', isAuth, checkRole('Admin'), standardItemCtrl.deleteStandardItem);
// router.post('/pay',    standardItemCtrl.processPayment);
// router.post('/checkoutStripe',    standardItemCtrl.confirmStripePayment);
// router.post('/checkoutPaypal',    standardItemCtrl.capturePayPalOrder);
module.exports = router;
