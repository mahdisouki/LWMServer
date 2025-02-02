const express = require('express');
const router = express.Router();
const tippingCtrl = require('../controllers/tippingCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const multer = require('../middlewares/multer');

router.post('/create-tipping', isAuth, checkRole('Driver', 'Helper'), tippingCtrl.createTippingRequest);
router.post('/ship-tipping', isAuth, checkRole('Driver', 'Helper'), tippingCtrl.markShipped);
router.get('/tipping-driver', isAuth, checkRole('Driver', 'Helper'), tippingCtrl.getAllTippingRequestsForUser);
router.get('/tipping-driver/:id', isAuth, checkRole('Driver', 'Helper'), tippingCtrl.getTippingRequestById);
router.get('/tipping-driver-helper/:userId', isAuth, checkRole('Driver', 'Helper'), tippingCtrl.getTippingRequestByUserId);
router.post('/upload-tipping-proof/:id', isAuth, checkRole('Driver'), multer.array('files'), tippingCtrl.uploadTippingProof);

router.get('/tipping', tippingCtrl.getAllTippingRequestsForAdmin);
router.get('/tipping/:id', isAuth, checkRole('Admin'), tippingCtrl.getTippingRequestById);
router.delete('/tipping/:id', isAuth, checkRole('Admin'), tippingCtrl.deleteTippingRequest);
router.put('/tipping/:id/validate', isAuth, checkRole('Admin'), tippingCtrl.updateTippingRequestStatus);
router.get('/tipping/getLocations/:tippingRequestId', tippingCtrl.getTippingRequestLocations)
module.exports = router;
