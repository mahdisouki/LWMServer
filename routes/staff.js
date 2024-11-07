const express = require('express');
const router = express.Router();
const staffCtrl = require('../controllers/staffCtrl');  // Import the new user controller
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role')
const multer = require('../middlewares/multer');


router.post('/create-staff', isAuth, checkRole('Admin'),  multer.single('picture'), staffCtrl.addStaff);
router.get('/staff', isAuth, checkRole('Admin'), staffCtrl.getAllStaff);
router.get('/staff/:id', isAuth, checkRole('Admin'), staffCtrl.getStaffById);
router.delete('/staff/:id', isAuth, checkRole('Admin'), staffCtrl.deleteStaff);
router.put('/staff/:id', isAuth, checkRole('Admin'),multer.single('picture'), staffCtrl.updateStaff);
router.post('/assignDriver/:driverId',isAuth, checkRole('Admin'), staffCtrl.assignDriverToTruck);
router.put('/updateDriverLocation/:driverId',isAuth, checkRole('Admin'), staffCtrl.updateDriverLocation);
router.post('/assignHelper/:helperId',isAuth, checkRole('Admin'), staffCtrl.assignHelperToTruck);
router.delete('/deassignHelper/:helperId', isAuth, checkRole('Admin'), staffCtrl.deassignHelperFromTruck);
router.delete('/deassignDriver/:driverId', isAuth, checkRole('Admin'), staffCtrl.deassignDriverFromTruck);
// Get Tasks for Driver
router.get('/getTasks/:id', isAuth, staffCtrl.getTasksForDriver);
// update admin profile
router.put('/admin/updateProfile', isAuth, checkRole('Admin'), multer.single('picture'), staffCtrl.updateAdminProfile);


module.exports = router;
