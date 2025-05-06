const express = require("express");
const router = express.Router();
const storageCtrl = require("../controllers/storageCtrl");
const multer = require("../middlewares/multer");  

router.post("/add-items", multer.array("proofs"), storageCtrl.addItems);

router.post("/remove-items",multer.array("proofs"), storageCtrl.removeItems);
router.get("/storages", storageCtrl.getStoragesByDate);
router.put("/storages/:id", multer.array("proofs"),storageCtrl.updateStorageById);
router.get("/total-items-in-storage", storageCtrl.getTotalItemsInStorage);
router.get('/totals-by-storage-place', storageCtrl.getTotalItemsGroupedByStoragePlace);


router.post('/storage-places', multer.single('image'), storageCtrl.create);
router.get('/storage-places', storageCtrl.getAll);
router.get('/storage-places/:id', storageCtrl.getOne);
router.put('/storage-places/:id', multer.single('image'), storageCtrl.update);
router.delete('/storage-places/:id', storageCtrl.delete);
module.exports = router;
