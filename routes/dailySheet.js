const express = require("express");
const router = express.Router();
const dailySheetController = require("../controllers/dailySheetController");

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
module.exports = router;
