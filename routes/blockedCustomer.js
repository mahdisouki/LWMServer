const express = require('express');
const router = express.Router();
const blockedCustomerCtrl = require('../controllers/blockedCustomerCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

router.use(isAuth, checkRole('Admin'));

router.get('/', blockedCustomerCtrl.listBlockedCustomers);
router.post('/check', blockedCustomerCtrl.checkBlockedCustomer);
router.post('/from-task/:taskId', blockedCustomerCtrl.blockFromTask);
router.patch('/:id/unblock', blockedCustomerCtrl.unblockCustomer);

module.exports = router;
