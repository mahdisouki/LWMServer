const express = require('express');
const router = express.Router();
const brokerLeadCtrl = require('../controllers/brokerLeadCtrl');
const brokerContactCtrl = require('../controllers/brokerContactCtrl');
const brokerQuoteRequestCtrl = require('../controllers/brokerQuoteRequestCtrl');
const brokerNegotiationCtrl = require('../controllers/brokerNegotiationCtrl');
const brokerOrderCtrl = require('../controllers/brokerOrderCtrl');
const brokerTaskCtrl = require('../controllers/brokerTaskCtrl');
const brokerDocumentCtrl = require('../controllers/brokerDocumentCtrl');
const brokerReportCtrl = require('../controllers/brokerReportCtrl');
const upload = require('../middlewares/multer');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const { requireActiveBroker } = require('../middlewares/brokerStatus');

router.use(isAuth, checkRole('Broker'), requireActiveBroker);

router.get('/me/dashboard', brokerLeadCtrl.getMyDashboard);
router.patch('/me/profile', brokerLeadCtrl.updateMyProfile);
router.get('/me/leads', brokerLeadCtrl.getMyLeads);
router.get('/me/leads/:leadId', brokerLeadCtrl.getMyLeadById);
router.post('/me/leads', brokerLeadCtrl.createMyLead);
router.patch('/me/leads/:leadId', brokerLeadCtrl.updateMyLead);

router.get('/me/contacts', brokerContactCtrl.listMine);
router.post('/me/contacts', brokerContactCtrl.createMine);
router.patch('/me/contacts/:contactId', brokerContactCtrl.updateMine);

router.get('/me/quote-requests', brokerQuoteRequestCtrl.listMine);
router.post('/me/quote-requests', brokerQuoteRequestCtrl.createMine);
router.patch('/me/quote-requests/:quoteRequestId', brokerQuoteRequestCtrl.updateMine);

router.get('/me/negotiations', brokerNegotiationCtrl.listMine);
router.post('/me/negotiations', brokerNegotiationCtrl.createMine);
router.patch('/me/negotiations/:negotiationId', brokerNegotiationCtrl.updateMine);

router.get('/me/orders', brokerOrderCtrl.listMine);
router.post('/me/orders', brokerOrderCtrl.createMine);
router.patch('/me/orders/:orderId', brokerOrderCtrl.updateMine);

router.get('/me/tasks', brokerTaskCtrl.listMine);
router.post('/me/tasks', brokerTaskCtrl.createMine);
router.patch('/me/tasks/:taskId', brokerTaskCtrl.updateMine);
router.get('/me/documents', brokerDocumentCtrl.listMine);
router.post('/me/documents', upload.single('file'), brokerDocumentCtrl.uploadMine);
router.delete('/me/documents/:documentId', brokerDocumentCtrl.removeMine);
router.get('/me/reports', brokerReportCtrl.getMine);

module.exports = router;
