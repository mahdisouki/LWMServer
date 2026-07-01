const express = require('express');
const router = express.Router();
const vanCtrl = require('../controllers/vanCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

router.post('/vans', isAuth, checkRole('Admin'), vanCtrl.createVan);
router.get('/vans', vanCtrl.getAllVans);
router.get('/vans/matricules', vanCtrl.getVanMatricules);
router.get('/vans/:id/items-in-truck', vanCtrl.getVanItemsInTruck);
router.put('/vans/:id/items-in-truck', isAuth, checkRole('Admin'), vanCtrl.updateVanItemsInTruck);
router.get('/vans/:id', vanCtrl.getVanById);
router.put('/vans/:id', isAuth, checkRole('Admin'), vanCtrl.updateVan);
router.delete('/vans/:id', isAuth, checkRole('Admin'), vanCtrl.deleteVan);

module.exports = router;