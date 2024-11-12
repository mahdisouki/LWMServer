const express = require('express');
const router = express.Router();
const tippingPlaceController = require('../controllers/tippingPlacesCtrl');

// Routes
router.post('/', tippingPlaceController.createTippingPlace);
router.get('/', tippingPlaceController.getAllTippingPlaces);
router.get('/:id', tippingPlaceController.getTippingPlaceById);
router.put('/:id', tippingPlaceController.updateTippingPlace);
router.delete('/:id', tippingPlaceController.deleteTippingPlace);

module.exports = router;
