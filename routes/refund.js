const express = require('express');
const router = express.Router();
const refundCtrl = require('../controllers/refundCtrl');

router.post('/refund-request', refundCtrl.createRefundRequest);
router.get('/refund-request/:id', refundCtrl.getRefundRequestById);
router.get('/refund-requests', refundCtrl.getAllRefundRequests);
router.delete('/refund-request/:id', refundCtrl.deleteRefundRequest);
router.put('/refund-request/:id', refundCtrl.updateRefundRequestStatus);

module.exports = router;
