const express = require('express');
const router = express.Router();
const truckCtrl = require('../controllers/truckCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

router.post('/trucks', isAuth, checkRole('Admin'), truckCtrl.createTruck);
router.get('/trucks', truckCtrl.getAllTrucks);
router.get(
  '/trucks-chat',
  isAuth,
  checkRole('Admin'),
  truckCtrl.getAllTrucksForChat,
);

router.delete('/trucks/:id', isAuth, checkRole('Admin'), truckCtrl.deleteTruck);

module.exports = router;
