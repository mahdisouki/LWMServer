const express = require('express');
const router = express.Router();
const subscriptionCtrl = require('../controllers/subscriptionCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

const admin = [isAuth, checkRole('Admin')];

router.get('/reminder-admins', ...admin, subscriptionCtrl.listReminderAdmins);
router.get('/', ...admin, subscriptionCtrl.list);
router.get('/:id', ...admin, subscriptionCtrl.getById);
router.post('/', ...admin, subscriptionCtrl.create);
router.put('/:id', ...admin, subscriptionCtrl.update);
router.patch('/:id', ...admin, subscriptionCtrl.update);
router.delete('/:id', ...admin, subscriptionCtrl.remove);

module.exports = router;
