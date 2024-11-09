const express = require('express');
const router = express.Router();
const driverCtrl = require('../controllers/driverCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const multer = require('../middlewares/multer');


router.get('/driver', isAuth, driverCtrl.getTasksForDriver);
router.post('/trucks/start/:truckId', isAuth, multer.array('uploads'), driverCtrl.updateTruckStart);
router.put('/driver', isAuth, multer.fields([{ name: 'picture', maxCount: 1 },{ name: 'DriverLicense', maxCount: 1 },{ name: 'addressProof', maxCount: 1 },{ name: 'NatInsurance', maxCount: 1 }]), driverCtrl.updateDriverProfile);
router.post('/driver/mark-day-start', isAuth, multer.none(), driverCtrl.markDayStart);

//router.get('/driver/helper-location', isAuth, driverCtrl.getHelperLocationForDriver);
router.post('/trucks/end/:truckId', isAuth, multer.array('uploads'), driverCtrl.updateTruckEnd);
router.put('/tasks/update-status/:taskId', isAuth, driverCtrl.updateJobStatus);
router.put('/tasks/rate/:taskId', isAuth, driverCtrl.rateTask);

router.post('/location/uploadItem/:taskId', isAuth, multer.array('uploads'), driverCtrl.uploadInitialConditionPhotos);
router.post('/truck/uploadItem/:taskId', isAuth, multer.array('uploads'), driverCtrl.uploadFinalConditionPhotos);
router.post('/truck/uploadIntermediateItem/:taskId', isAuth, multer.array('uploads'), driverCtrl.intermediateConditionPhotos);
router.post('/additional-items/uploadItem/:taskId', isAuth, multer.array('uploads'), driverCtrl.addAdditionalItems);

router.post('/break/start', isAuth, driverCtrl.startBreak);
router.post('/break/end',isAuth , driverCtrl.endBreak);
router.get('/break',isAuth , driverCtrl.getBreakTimer);
module.exports = router;