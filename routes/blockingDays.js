const express = require('express');
const blockingDaysCtrl = require('../controllers/blockingDays');
const authMiddleware = require('../middlewares/auth');
const router = express.Router();

router.post('/blocking-days', authMiddleware.isAuth, blockingDaysCtrl.createBlockingDay);
router.get('/blocking-days', authMiddleware.isAuth, blockingDaysCtrl.getAllBlockingDays);
router.get('/blocking-days/with-time-slots', authMiddleware.isAuth, blockingDaysCtrl.getAllBlockingDaysWithTimeSlots);
router.get('/blocking-days/full-blocking-days', authMiddleware.isAuth, blockingDaysCtrl.getFullBlockingDays);
router.get('/blocking-days/available-time-slots', authMiddleware.isAuth, blockingDaysCtrl.getAvailableTimeSlots);
router.get('/blocking-days/:id', authMiddleware.isAuth, blockingDaysCtrl.getBlockingDayById);
router.put('/blocking-days/:id', authMiddleware.isAuth, blockingDaysCtrl.updateBlockingDay);
router.delete('/blocking-days/:id', authMiddleware.isAuth, blockingDaysCtrl.deleteBlockingDay);

module.exports = router;