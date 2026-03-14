const express = require("express");
const router = express.Router();
const pcnDamageController = require("../controllers/pcnDamageController");
const parser = require('../middlewares/multer');

// Get all PCN/Damages (across all daily sheets)
router.get('/', pcnDamageController.getAllPcnDamages);

// Create PCN without daily sheet (standalone)
router.post('/', parser.single('proof'), pcnDamageController.addPcnDamageStandalone);

// Add existing PCN to a daily sheet
router.post('/add-to-sheet', pcnDamageController.addPcnDamageToDailySheet);

// Get PCN/Damages for a specific driver and date
router.get('/:driverId/:date', pcnDamageController.getPcnDamages);

// Add a new PCN/Damage and attach to daily sheet
router.post('/:driverId/:date', parser.single('proof'), pcnDamageController.addPcnDamage);

// Update a PCN/Damage
router.patch('/:driverId/:date/:pcnDamageId', parser.single('proof'), pcnDamageController.updatePcnDamage);

// Delete a PCN/Damage
router.delete('/:driverId/:date/:pcnDamageId', pcnDamageController.deletePcnDamage);

module.exports = router;

