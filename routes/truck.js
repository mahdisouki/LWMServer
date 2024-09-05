const express = require('express');
const router = express.Router();
const truckCtrl = require('../controllers/truckCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

router.post('/trucks', isAuth, checkRole('Admin'), truckCtrl.createTruck);
router.get('/trucks', isAuth, checkRole('Admin'), truckCtrl.getAllTrucks);

router.delete('/trucks/:id', isAuth, checkRole('Admin'), truckCtrl.deleteTruck);

module.exports = router;
