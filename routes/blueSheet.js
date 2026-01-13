const express = require('express');
const router = express.Router();
const blueSheetController = require('../controllers/blueSheetController');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

// Generate blue sheets for all trucks for a specific date
router.post('/generate', isAuth, checkRole('Admin'), blueSheetController.generateBlueSheetsForAllTrucks);

// Get all blue sheets for a specific date
router.get('/sheets', isAuth, checkRole('Admin'), blueSheetController.getBlueSheetsForDate);

// Get blue sheet for a specific truck and date
router.get('/sheets/:truckId', isAuth, checkRole('Admin'), blueSheetController.getBlueSheetForTruck);

// Update blue sheet (for manual updates like congestion, PCN/DAMAGE, etc.)
router.put('/sheets/:blueSheetId', isAuth, checkRole('Admin'), blueSheetController.updateBlueSheet);

module.exports = router;
