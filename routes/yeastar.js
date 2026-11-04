const express = require('express');
const router = express.Router();
const yeastarCtrl = require('../controllers/yeastarCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

const admin = [isAuth, checkRole('Admin')];

router.get('/status', ...admin, yeastarCtrl.getStatus);
router.get('/extensions', ...admin, yeastarCtrl.listExtensions);
router.post('/call', ...admin, yeastarCtrl.dial);

module.exports = router;
