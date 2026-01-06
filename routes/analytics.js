const express = require('express');
const analyticsCtrl = require('../controllers/analyticsCtrl');

const router = express.Router();

router.post('/interest-tracking', analyticsCtrl.trackInterest);
router.get('/interest-analytics', analyticsCtrl.getInterestAnalytics);

module.exports = router;

