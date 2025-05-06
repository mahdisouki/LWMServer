const express = require("express");
const router = express.Router();
const dailySheetController = require("../controllers/dailySheetController");
const parser = require('../middlewares/multer'); // adjust path if needed

// Generate daily sheets for all drivers
router.post("/generate", dailySheetController.generateDailySheetsForAllDrivers);

// Get daily sheets for all drivers by date
router.get("/sheets/:date", dailySheetController.getDailySheetsForAllDrivers);

// Update daily sheet for a specific driver by date
router.put(
  "/sheets/:driverId/:date",
  dailySheetController.updateDailySheetForDriver
);
router.get(
  "/sheets/:driverId/:date",
  dailySheetController.getDailySheetsbyId
);
router.post('/:driverId/:date/fuel',  dailySheetController.addFuelLog);
router.patch('/:driverId/:date/fuel/:fuelLogId',  dailySheetController.updateFuelLog);
router.delete('/:driverId/:date/fuel/:fuelLogId',  dailySheetController.deleteFuelLog);
router.put('/update-price/:tippingRequestId', dailySheetController.updateTippingPrice);
router.post('/:driverId/:date/expense',  parser.single('receipt'),dailySheetController.addExpense);
router.put('/:driverId/:date/expense/:expenseId', parser.single('receipt'), dailySheetController.updateExpense);
router.delete('/:driverId/:date/expense/:expenseId', dailySheetController.deleteExpense);
module.exports = router;
