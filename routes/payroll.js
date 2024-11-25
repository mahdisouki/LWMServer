// const express = require('express');
// const router = express.Router();
// const { isAuth } = require('../middlewares/auth');
// const { checkRole } = require('../middlewares/role');
// const payrollCtrl = require('../controllers/payrollCtrl');

// router.post('/mark-paid/:payrollId', isAuth, checkRole(['Admin']), payrollCtrl.markPayrollAsPaid);
// router.get('/payrolls', isAuth, checkRole(['Admin']), payrollCtrl.getAllPayrolls);
// router.delete('/payroll/:payrollId', isAuth, checkRole(['Admin']), payrollCtrl.deletePayroll);
// router.post('/payroll/mark-paid/:payrollId', isAuth, checkRole(['Admin']), payrollCtrl.markPayrollAsPaid);


// module.exports = router;