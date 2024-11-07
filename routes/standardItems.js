const express = require('express');
const router = express.Router();
const standardItemCtrl = require('../controllers/standardItemCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role')
const multer = require('../middlewares/multer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

router.post('/item', isAuth, checkRole('Admin'), multer.single('image'), standardItemCtrl.createStandardItem);
router.get('/items', standardItemCtrl.getAllStandardItems);
router.get('/items/category/:category', standardItemCtrl.getItemsByCategory); 
router.get('/items/:id', standardItemCtrl.getStandardItemById);
router.put('/items/:id', isAuth, checkRole('Admin'), multer.single('image'), standardItemCtrl.updateStandardItem);
router.delete('/items/:id', isAuth, checkRole('Admin'), standardItemCtrl.deleteStandardItem);
// router.post('/pay',    standardItemCtrl.processPayment);
// router.post('/checkoutStripe',    standardItemCtrl.confirmStripePayment);
// router.post('/checkoutPaypal',    standardItemCtrl.capturePayPalOrder);
module.exports = router;
