const express = require('express');
const router = express.Router();
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const payrollCtrl = require('../controllers/payrollCtrl');

router.post('/mark-paid/:payrollId', isAuth, checkRole(['admin']), payrollCtrl.markPayrollAsPaid);
router.get('/payrolls', isAuth, checkRole(['admin']), payrollCtrl.getAllPayrolls);



module.exports = router;