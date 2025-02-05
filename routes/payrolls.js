const express = require('express');
const PayrollCtrl = require('../controllers/payrollCtrl');
const router = express.Router();

// Middleware to protect routes if needed
const { isAuth } = require('../middlewares/auth');

// Log start time for the day
router.post('/payroll/log-start-time', isAuth, PayrollCtrl.logStartTime);

// Log end time for the day
router.post('/payroll/log-end-time', isAuth, PayrollCtrl.logEndTime);

// Get individual payroll records for the logged-in user
router.get('/payroll', isAuth, PayrollCtrl.getIndividualPayrollRecords);

// Update payroll record by payroll ID for the logged-in user
router.put('/payroll/:payrollId', isAuth, PayrollCtrl.updatePayrollRecord);

// Get total worked hours and salary for the logged-in user
router.get('/payroll/total', isAuth, PayrollCtrl.getTotalWorkedHoursAndSalaryForUser);

// Get worked hours and salary for all users (Admin access)
router.get('/payroll/all-users', isAuth, PayrollCtrl.getAllWorkedHoursAndSalaryForAllUsers);

// Reset payroll for a specific user
router.put('/payroll/reset/:userId', isAuth, PayrollCtrl.resetPayroll);

// Admin - Get all payroll records
router.get('/payroll/admin/all',  PayrollCtrl.getAllPayrolls);

// Admin - Get payroll records for a specific user by user ID
router.get('/payroll/admin/user/:userId', isAuth, PayrollCtrl.getPayrollsByUserId);

// Admin - Update a payroll record for a user by payroll ID
router.put('/payroll/admin/update/:payrollId', isAuth, PayrollCtrl.updatePayrollAdmin);

// Admin - Delete a payroll record for a user by payroll ID
router.delete('/payroll/admin/delete/:payrollId', isAuth, PayrollCtrl.deletePayroll);

// Mark payroll as paid
router.put('/payroll/mark-paid/:payrollId', isAuth, PayrollCtrl.markPayrollAsPaid);

module.exports = router;
