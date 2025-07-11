const express = require('express');
const router = express.Router();
const staffCtrl = require('../controllers/staffCtrl'); 
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role')
const multer = require('../middlewares/multer');
const { checkPermissions } = require('../middlewares/permissions'); 


router.post('/create-staff',multer.fields([{ name: 'picture', maxCount: 1 },{ name: 'DriverLicense', maxCount: 1 },{ name: 'addressProof', maxCount: 1 },{ name: 'NatInsurance', maxCount: 1 }]),staffCtrl.addStaff);
router.get('/staff',  staffCtrl.getAllStaff);
router.get('/staff/:id', isAuth, checkRole('Admin'), staffCtrl.getStaffById);
router.delete('/staff/:id', isAuth, checkRole('Admin'), staffCtrl.deleteStaff);
router.put('/staff/:id', isAuth, checkRole('Admin'),multer.fields([{ name: 'picture', maxCount: 1 },{ name: 'DriverLicense', maxCount: 1 },{ name: 'addressProof', maxCount: 1 },{ name: 'NatInsurance', maxCount: 1 }]), staffCtrl.updateStaff);
router.post('/assignDriver/:driverId',isAuth, checkRole('Admin') ,staffCtrl.assignDriverToTruck);
router.put('/updateDriverLocation/:driverId',isAuth, checkRole('Admin'), staffCtrl.updateDriverLocation);
router.post('/assignHelper/:helperId',isAuth, checkRole('Admin'), staffCtrl.assignHelperToTruck);
router.delete('/deassignHelper/:helperId', isAuth, checkRole('Admin'),  staffCtrl.deassignHelperFromTruck);
router.delete('/deassignDriver/:driverId', isAuth, checkRole('Admin'), staffCtrl.deassignDriverFromTruck);
// Get Tasks for Driver
router.get('/getTasks/:id', isAuth, staffCtrl.getTasksForDriver);
// update admin profile
router.put('/admin/updateProfile', isAuth, checkRole('Admin'), multer.single('picture'), staffCtrl.updateAdminProfile);
// update admin email signature
router.put('/admin/email-signature', isAuth, checkRole('Admin'), staffCtrl.updateEmailSignature);
router.post('/optimise/:truckId' , staffCtrl.optimizeTasks )

module.exports = router;
