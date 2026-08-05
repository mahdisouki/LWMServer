const express = require('express');
const router = express.Router();
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const networkCtrl = require('../controllers/networkCtrl');

const adminOnly = [isAuth, checkRole('Admin')];

router.get('/network/sessions', ...adminOnly, networkCtrl.listActiveSessions);
router.get('/network/sessions/history', ...adminOnly, networkCtrl.getSessionHistory);
router.get('/network/users/:userId/sessions', ...adminOnly, networkCtrl.getUserSessions);
router.post('/network/sessions/:sessionId/revoke', ...adminOnly, networkCtrl.revokeSession);
router.post('/network/users/:userId/revoke-all', ...adminOnly, networkCtrl.revokeAllUserSessions);

module.exports = router;
