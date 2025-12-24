const express = require('express');
const router = express.Router();
const tippingPlaceController = require('../controllers/tippingPlacesCtrl');
const multer = require('../middlewares/multer');

// Routes
router.post('/', multer.single('image'), tippingPlaceController.createTippingPlace);
router.get('/', tippingPlaceController.getAllTippingPlaces);
router.get('/:id', tippingPlaceController.getTippingPlaceById);
router.put('/:id', multer.single('image'), tippingPlaceController.updateTippingPlace);
router.delete('/:id', tippingPlaceController.deleteTippingPlace);

module.exports = router;
