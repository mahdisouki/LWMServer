const express = require('express');
const clarityCtrl = require('../controllers/clarityCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

const router = express.Router();
const admin = [isAuth, checkRole('Admin')];

router.get('/overview', ...admin, clarityCtrl.getOverview);
router.get('/top-pages', ...admin, clarityCtrl.getTopPages);
router.get('/traffic-sources', ...admin, clarityCtrl.getTrafficSources);
router.get('/devices', ...admin, clarityCtrl.getDeviceBreakdown);
router.get('/insights', ...admin, clarityCtrl.getCustom);
router.get('/history', ...admin, clarityCtrl.getHistory);
router.post('/sync', ...admin, clarityCtrl.triggerSync);

module.exports = router;
