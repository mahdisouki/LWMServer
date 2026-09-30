const express = require('express');
const router = express.Router();
const refundCtrl = require('../controllers/refundCtrl');
const refundRequestCtrl = require('../controllers/refundRequestCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

const adminOnly = [isAuth, checkRole('Admin')];

// Direct refund (super admin only — enforced in controller)
router.post('/refund', ...adminOnly, refundCtrl.processRefund);
router.post('/refund/manual', ...adminOnly, refundCtrl.processManualRefund);

// Refund approval workflow
router.post('/requests', ...adminOnly, refundRequestCtrl.createRefundRequest);
router.get('/requests', ...adminOnly, refundRequestCtrl.listRefundRequests);
router.get('/requests/:id', ...adminOnly, refundRequestCtrl.getRefundRequest);
router.post('/requests/:id/accept', ...adminOnly, refundRequestCtrl.acceptRefundRequest);
router.post('/requests/:id/refuse', ...adminOnly, refundRequestCtrl.refuseRefundRequest);

module.exports = router;
