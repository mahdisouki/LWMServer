const express = require('express');
const blockingDaysCtrl = require('../controllers/blockingDays');

const router = express.Router();

router.post('/blocking-days', blockingDaysCtrl.createBlockingDay);
router.get('/blocking-days', blockingDaysCtrl.getAllBlockingDays);
router.get('/blocking-days/:id', blockingDaysCtrl.getBlockingDayById);
router.put('/blocking-days/:id', blockingDaysCtrl.updateBlockingDay);
router.delete('/blocking-days/:id', blockingDaysCtrl.deleteBlockingDay);

module.exports = router;