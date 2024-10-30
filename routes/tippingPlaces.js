const express = require('express');
const router = express.Router();
const tippingPlaceCtrl = require('../controllers/tippingPlacesCtrl');
// const { isAuth } = require('../middlewares/auth'); // Uncomment if you have authentication middleware

// Routes
router.post('/', tippingPlaceCtrl.createTippingPlace);
router.get('/', tippingPlaceCtrl.getAllTippingPlaces);
router.get('/:id', tippingPlaceCtrl.getTippingPlaceById);
router.put('/:id', tippingPlaceCtrl.updateTippingPlace);
router.delete('/:id', tippingPlaceCtrl.deleteTippingPlace);

module.exports = router;
