const express = require('express');
const router = express.Router();
const driverCtrl = require('../controllers/driverCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const multer = require('../middlewares/multer');


router.get('/driver/:driverId', driverCtrl.getTasksForDriver);
router.post('/trucks/start/:truckId', multer.array('uploads'), driverCtrl.updateTruckStart);

router.post('/trucks/end/:truckId', multer.array('uploads'), driverCtrl.updateTruckEnd);
// router.post('/rateTask/:taskId', driverCtrl.rateTask);
module.exports = router;