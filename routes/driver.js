const express = require('express');
const router = express.Router();
const driverCtrl = require('../controllers/driverCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const multer = require('../middlewares/multer');
const multerLib = require('multer');

// Helper function to wrap multer middleware with error handling
const handleMulterError = (multerMiddleware) => {
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (err) {
        // Handle multer errors
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            message: 'Too many files uploaded',
            error: `Maximum ${err.limit || 50} files allowed per upload`,
            code: err.code
          });
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            message: 'File too large',
            error: 'Maximum file size is 100MB per file',
            code: err.code
          });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            message: 'Unexpected file field',
            error: err.message,
            code: err.code
          });
        }
        // Handle other multer errors
        if (err instanceof multerLib.MulterError) {
          return res.status(400).json({
            message: 'File upload error',
            error: err.message,
            code: err.code
          });
        }
        // Handle other errors
        return res.status(400).json({
          message: 'File upload error',
          error: err.message
        });
      }
      next();
    });
  };
};


router.get('/driver', isAuth, driverCtrl.getTasksForDriver);
router.get('/driver/tasks-by-date', isAuth, driverCtrl.getTasksPerDate);
router.post('/driver/add-tipping-to-truck', isAuth, driverCtrl.addTippingRequestToTruck);
router.post('/trucks/start/:truckId', isAuth, handleMulterError(multer.array('uploads', 20)), driverCtrl.updateTruckStart);
router.put('/driver', isAuth, multer.fields([{ name: 'picture', maxCount: 1 }, { name: 'drivingLicenseFront', maxCount: 1 }, { name: 'addressProof', maxCount: 1 }, { name: 'NatInsurance', maxCount: 1 }]), driverCtrl.updateDriverProfile);
router.post('/driver/mark-day-start', isAuth, multer.none(), driverCtrl.markDayStart);

router.get('/driver/helper-location', isAuth, driverCtrl.getHelperLocationForDriver);
router.get('/driver/helper-distance', isAuth, driverCtrl.getDriverDistanceToHelper);
router.get('/driver/helper-info', isAuth, driverCtrl.getHelperInfoForDriver);
router.post('/trucks/end/:truckId', isAuth, handleMulterError(multer.array('uploads', 20)), driverCtrl.updateTruckEnd);
router.get('/trucks/status/:truckId', driverCtrl.getTruckFullStatus);
router.put('/tasks/update-status/:taskId', isAuth, driverCtrl.updateJobStatus);
router.put('/tasks/:taskId/redflag', isAuth, driverCtrl.updateTaskRedflag);
router.put('/tasks/rate/:taskId', isAuth, handleMulterError(multer.single('signature')), driverCtrl.rateTask);

// Task image uploads - allow up to 50 files per upload
router.post('/location/uploadItem/:taskId', isAuth, handleMulterError(multer.array('uploads', 50)), driverCtrl.uploadInitialConditionPhotos);
router.post('/truck/uploadItem/:taskId', isAuth, handleMulterError(multer.array('uploads', 50)), driverCtrl.uploadFinalConditionPhotos);
router.post('/truck/uploadIntermediateItem/:taskId', isAuth, handleMulterError(multer.array('uploads', 50)), driverCtrl.intermediateConditionPhotos);
router.post('/additional-items/uploadItem/:taskId', isAuth, handleMulterError(multer.array('uploads', 50)), driverCtrl.addAdditionalItems);

router.post('/break/start', isAuth, driverCtrl.startBreak);
router.post('/break/end', isAuth, driverCtrl.endBreak);
router.get('/break', isAuth, driverCtrl.getBreakTimer);

router.post('/location/update', isAuth, driverCtrl.updateMyLocation);

// Check if shift has started for the day
router.get('/driver/day-start-status', isAuth, driverCtrl.getDayStartStatus);
router.get('/driver/start-button-status', isAuth, driverCtrl.getStartButtonStatus);
router.get('/driver/end-button-status', isAuth, driverCtrl.getEndButtonStatus);

// Get all on-work drivers and helpers with their last location
router.get('/driver/on-work-locations', isAuth, driverCtrl.getOnWorkStaffLocations);

// Get current and next job addresses for a truck
router.get('/truck/:truckId/job-addresses', isAuth, driverCtrl.getCurrentAndNextJobAddress);

// Cleanup corrupted truck tasks data
router.post('/cleanup-truck-tasks', isAuth, async (req, res) => {
  try {
    const Truck = require('../models/Truck');
    const cleanedCount = await Truck.cleanupTasks();
    res.json({
      message: 'Truck tasks cleanup completed',
      cleanedCount
    });
  } catch (error) {
    console.error('Truck tasks cleanup failed:', error);
    res.status(500).json({
      message: 'Cleanup failed',
      error: error.message
    });
  }
});


module.exports = router;