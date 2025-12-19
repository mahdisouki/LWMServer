const express = require('express');
const blockingDaysCtrl = require('../controllers/blockingDays');
const authMiddleware = require('../middlewares/auth');
const router = express.Router();

router.post('/blocking-days', authMiddleware.isAuth, checkRole('Admin'), blockingDaysCtrl.createBlockingDay);
router.get('/blocking-days',  blockingDaysCtrl.getAllBlockingDays);
router.get('/blocking-days/with-time-slots',  blockingDaysCtrl.getAllBlockingDaysWithTimeSlots);
router.get('/blocking-days/full-blocking-days',  blockingDaysCtrl.getFullBlockingDays);
router.get('/blocking-days/available-time-slots',  blockingDaysCtrl.getAvailableTimeSlots);
router.get('/blocking-days/:id',  blockingDaysCtrl.getBlockingDayById);
router.put('/blocking-days/:id', authMiddleware.isAuth, checkRole('Admin'), blockingDaysCtrl.updateBlockingDay);
router.delete('/blocking-days/:id', authMiddleware.isAuth, checkRole('Admin'), blockingDaysCtrl.deleteBlockingDay);

module.exports = router;