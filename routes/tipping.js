const express = require('express');
const router = express.Router();
const tippingCtrl = require('../controllers/tippingCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

router.post('/create-tipping', isAuth, checkRole('Driver', 'Helper'), tippingCtrl.createTippingRequest);
router.get('/tipping-driver', isAuth, checkRole('Driver', 'Helper'), tippingCtrl.getAllTippingRequestsForUser);
router.get('/tipping-driver/:id', isAuth, checkRole('Driver', 'Helper'), tippingCtrl.getTippingRequestById);

router.get('/tipping', tippingCtrl.getAllTippingRequestsForAdmin);
router.get('/tipping/:id', isAuth, checkRole('Admin'), tippingCtrl.getTippingRequestById);
router.put('/tipping/:id', isAuth, checkRole('Admin'), tippingCtrl.updateTippingRequest);
router.delete('/tipping/:id', isAuth, checkRole('Admin'), tippingCtrl.deleteTippingRequest);
router.put('/tipping/:id/validate', isAuth, checkRole('Admin'), tippingCtrl.updateTippingRequestStatus);


module.exports = router;
