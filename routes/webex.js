const express = require('express');
const router = express.Router();
const webexCtrl = require('../controllers/webexCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

const admin = [isAuth, checkRole('Admin')];

router.get('/status', ...admin, webexCtrl.getStatus);
router.get('/auth/url', ...admin, webexCtrl.getAuthUrl);
router.get('/oauth/callback', webexCtrl.oauthCallback); // public redirect from Webex
router.get('/token', ...admin, webexCtrl.getAccessToken);
router.post('/token/personal', ...admin, webexCtrl.savePersonalToken);
router.delete('/disconnect', ...admin, webexCtrl.disconnect);

module.exports = router;
