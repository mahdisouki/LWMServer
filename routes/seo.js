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
router.get('/keywords/top-search', ...admin, seoCtrl.getTopSearchKeywords);
router.get('/keywords', ...admin, seoCtrl.getKeywords);
router.post('/keywords/track', ...admin, seoCtrl.trackKeyword);
router.delete('/keywords/:id', ...admin, seoCtrl.deleteKeyword);

router.post('/refresh', ...admin, seoCtrl.triggerRefresh);
router.get('/refresh/status', ...admin, seoCtrl.getRefreshStatus);

router.get('/competitors', ...admin, seoCtrl.getCompetitors);
router.post('/competitors', ...admin, seoCtrl.addCompetitor);
router.post('/competitors/sync', ...admin, seoCtrl.syncCompetitorMetrics);
router.delete('/competitors/:id', ...admin, seoCtrl.deleteCompetitor);
router.get('/competitors/content-gaps', ...admin, seoCtrl.getContentGaps);
router.post('/competitors/content-gaps/:id/create-page', ...admin, seoCtrl.createPageFromContentGap);

router.get('/indexation/summary', ...admin, seoCtrl.getIndexationSummary);
router.get('/indexation/pages', ...admin, seoCtrl.getIndexationPages);
router.post('/indexation/pages/:id/inspect', ...admin, seoCtrl.inspectIndexationPage);

router.get('/agent/status', ...admin, seoCtrl.getAgentStatus);
router.post('/agent/enrich-audit', ...admin, seoCtrl.enrichAuditWithAgent);

module.exports = router;
