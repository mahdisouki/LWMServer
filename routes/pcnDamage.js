const express = require("express");
const router = express.Router();
const pcnDamageController = require("../controllers/pcnDamageController");
const parser = require('../middlewares/multer');

// Get all PCN/Damages (across all daily sheets)
router.get('/', pcnDamageController.getAllPcnDamages);

// Create PCN without daily sheet (standalone) - COMMENTED OUT
// router.post('/', parser.single('proof'), pcnDamageController.addPcnDamageStandalone);

// Add existing PCN to a daily sheet
router.post('/add-to-sheet', pcnDamageController.addPcnDamageToDailySheet);

// Get driver assigned to a van at a specific date/time
router.get('/get-driver', pcnDamageController.getDriverFromVanAndTime);

// Get PCN/Damages for a specific driver and date
router.get('/:driverId/:date', pcnDamageController.getPcnDamages);

// Add a new PCN/Damage - links to DailySheet if it exists, otherwise creates standalone
// Note: date, vanMatricule, and time are required in body - driver is determined from unitAssignment
// If DailySheet doesn't exist, PCN is created standalone and can be linked later using /add-to-sheet
router.post('/add', parser.single('proof'), pcnDamageController.addPcnDamage);

// Update a PCN/Damage
router.patch('/:driverId/:date/:pcnDamageId', parser.single('proof'), pcnDamageController.updatePcnDamage);

// Update only payment status for a PCN/Damage
router.patch('/:pcnDamageId/payment-status', pcnDamageController.updatePcnPaymentStatus);

// Delete a PCN/Damage
router.delete('/:driverId/:date/:pcnDamageId', pcnDamageController.deletePcnDamage);

module.exports = router;

