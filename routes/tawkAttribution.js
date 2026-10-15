const express = require('express');
const router = express.Router();
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const tawkAttributionCtrl = require('../controllers/tawkAttributionCtrl');

router.post(
  '/attribution/tawk',
  tawkAttributionCtrl.upsertTawkLeadHandler,
);

router.get(
  '/attribution/lookup',
  isAuth,
  checkRole('Admin'),
  tawkAttributionCtrl.lookupAttribution,
);

module.exports = router;
