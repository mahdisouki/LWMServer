const express = require("express");
const router = express.Router();
const storageCtrl = require("../controllers/storageCtrl");
const multer = require("../middlewares/multer");  

router.post("/add-items", multer.array("proofs"), storageCtrl.addItems);

router.post("/remove-items",multer.array("proofs"), storageCtrl.removeItems);
router.get("/storages", storageCtrl.getStoragesByDate);
router.get("/total-items-in-storage", storageCtrl.getTotalItemsInStorage);

module.exports = router;
