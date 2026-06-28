const express = require('express');
const router = express.Router();
const seoCtrl = require('../controllers/seoCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

const admin = [isAuth, checkRole('Admin')];

router.get('/overview', ...admin, seoCtrl.getOverview);
router.get('/site-health', ...admin, seoCtrl.getSiteHealth);

router.get('/audit/summary', ...admin, seoCtrl.getAuditSummary);
router.get('/audit/issues', ...admin, seoCtrl.getAuditIssues);
router.get('/audit/issues/:id', ...admin, seoCtrl.getAuditIssueById);

router.get('/keywords/summary', ...admin, seoCtrl.getKeywordsSummary);
router.get('/keywords', ...admin, seoCtrl.getKeywords);
router.post('/keywords/track', ...admin, seoCtrl.trackKeyword);
router.delete('/keywords/:id', ...admin, seoCtrl.deleteKeyword);

router.post('/refresh', ...admin, seoCtrl.triggerRefresh);
router.get('/refresh/status', ...admin, seoCtrl.getRefreshStatus);

module.exports = router;
