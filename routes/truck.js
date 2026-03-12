const express = require('express');
const router = express.Router();
const truckCtrl = require('../controllers/truckCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

router.post('/trucks', isAuth, checkRole('Admin'), truckCtrl.createTruck);
router.get('/trucks', truckCtrl.getAllTrucks);
router.get('/trucks/matricules', truckCtrl.getTruckMatricules);
router.get('/trucks/:id/assignments-on-day', truckCtrl.getAssignmentsOnDay);
router.get('/trucks/:id/assignment-at', truckCtrl.getAssignmentAtTime);
router.put('/trucks/:id', isAuth, checkRole('Admin'), truckCtrl.updateTruck);
router.post('/trucks/assign-van', isAuth, checkRole('Admin'), truckCtrl.assignVanToTruck);
router.post('/trucks/deassign-van', isAuth, checkRole('Admin'), truckCtrl.deassignVanFromTruck);
router.get('/trucks-chat',
  isAuth,
  checkRole('Admin'),
  truckCtrl.getAllTrucksForChat,
);

router.delete('/trucks/:id', isAuth, checkRole('Admin'), truckCtrl.deleteTruck);

module.exports = router;
