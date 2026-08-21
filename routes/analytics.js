const express = require('express');
const analyticsCtrl = require('../controllers/analyticsCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

const router = express.Router();
const admin = [isAuth, checkRole('Admin')];

router.post('/interest-tracking', analyticsCtrl.trackInterest);
router.get('/interest-analytics', analyticsCtrl.getInterestAnalytics);

router.get('/dashboard', ...admin, analyticsCtrl.getDashboard);
router.get('/dashboard/pages', ...admin, analyticsCtrl.getDashboardPages);
router.get('/traffic-overview', ...admin, analyticsCtrl.getTrafficOverview);
router.get('/conversion-funnel', ...admin, analyticsCtrl.getConversionFunnel);
router.get('/goal-completions', ...admin, analyticsCtrl.getGoalCompletions);
router.get('/devices', ...admin, analyticsCtrl.getDevices);
router.get('/page-performance', ...admin, analyticsCtrl.getPagePerformance);
router.get('/top-postcodes', ...admin, analyticsCtrl.getTopPostcodes);
router.get('/popular-items', ...admin, analyticsCtrl.getPopularItems);
router.get('/order-traffic-sources', ...admin, analyticsCtrl.getOrderTrafficSources);
router.get('/paid-search-terms', ...admin, analyticsCtrl.getPaidSearchTerms);
router.get('/admin-orders', ...admin, analyticsCtrl.getAdminOrders);
router.get('/staff-working-hours', ...admin, analyticsCtrl.getStaffWorkingHours);

module.exports = router;
