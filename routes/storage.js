const express = require("express");
const router = express.Router();
const storageCtrl = require("../controllers/storageCtrl");
const multer = require("../middlewares/multer");

router.post("/add-items", multer.array("proofs"), storageCtrl.addItems);

router.post("/remove-items", multer.array("proofs"), storageCtrl.removeItems);
router.get("/storages", storageCtrl.getAllStorages);
router.get("/storages/all", storageCtrl.getAllStorages);
router.put("/storages/:id", multer.array("proofs"), storageCtrl.updateStorageById);
router.delete('/storages/:id', storageCtrl.deleteStorageRecord);
router.get("/total-items-in-storage", storageCtrl.getTotalItemsInStorage);
router.get('/totals-by-storage-place', storageCtrl.getTotalItemsGroupedByStoragePlace);

// Hard reset rubbish (other) field across all records
router.post('/reset-other', storageCtrl.resetOtherQuantity);

// Get storages by user id (driver or helper)
router.get('/storages/user/:userId', storageCtrl.getStoragesByUserId);


router.post('/storage-places', multer.single('image'), storageCtrl.create);
router.get('/storage-places', storageCtrl.getAll);
router.get('/storage-places/:id', storageCtrl.getOne);
router.put('/storage-places/:id', multer.single('image'), storageCtrl.update);
router.delete('/storage-places/:id', storageCtrl.delete);
module.exports = router;
