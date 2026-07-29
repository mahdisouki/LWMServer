const express = require('express');
const router = express.Router();
const brokerCtrl = require('../controllers/brokerCtrl');
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

router.use(isAuth, checkRole('Admin'));

router.get('/stats', brokerCtrl.getBrokerStats);
router.get('/overdue-follow-ups', brokerCtrl.getOverdueFollowUps);
router.get('/', brokerCtrl.getBrokers);
router.post('/', brokerCtrl.createBroker);

// Lead routes before /:id to avoid param conflicts
router.patch('/leads/:leadId', brokerLeadCtrl.updateLead);
router.delete('/leads/:leadId', brokerLeadCtrl.deleteLead);

router.patch('/contacts/:contactId', brokerContactCtrl.update);
router.delete('/contacts/:contactId', brokerContactCtrl.remove);
router.patch('/quote-requests/:quoteRequestId', brokerQuoteRequestCtrl.update);
router.patch('/negotiations/:negotiationId', brokerNegotiationCtrl.update);
router.patch('/orders/:orderId', brokerOrderCtrl.update);
router.patch('/tasks/:taskId', brokerTaskCtrl.update);
router.delete('/documents/:documentId', brokerDocumentCtrl.remove);

router.get('/:id/detail-stats', brokerCtrl.getBrokerDetailStats);
router.get('/:id/leads', brokerLeadCtrl.getLeadsByBroker);
router.post('/:brokerId/leads', brokerLeadCtrl.createLead);
router.get('/:id/contacts', brokerContactCtrl.listByBroker);
router.post('/:brokerId/contacts', brokerContactCtrl.create);
router.get('/:id/quote-requests', brokerQuoteRequestCtrl.listByBroker);
router.post('/:brokerId/quote-requests', brokerQuoteRequestCtrl.create);
router.get('/:id/negotiations', brokerNegotiationCtrl.listByBroker);
router.post('/:brokerId/negotiations', brokerNegotiationCtrl.create);
router.get('/:id/orders', brokerOrderCtrl.listByBroker);
router.post('/:brokerId/orders', brokerOrderCtrl.create);
router.get('/:id/tasks', brokerTaskCtrl.listByBroker);
router.post('/:brokerId/tasks', brokerTaskCtrl.create);
router.get('/:id/documents', brokerDocumentCtrl.listByBroker);
router.post('/:brokerId/documents', upload.single('file'), brokerDocumentCtrl.upload);
router.get('/:id/reports', brokerReportCtrl.getByBroker);
router.get('/:id', brokerCtrl.getBrokerById);
router.patch('/:id', brokerCtrl.updateBroker);
router.delete('/:id', brokerCtrl.deleteBroker);

module.exports = router;
