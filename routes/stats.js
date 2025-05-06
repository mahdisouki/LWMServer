// routes/statsRoutes.js
const express = require('express');
const statsCtrl = require('../controllers/statsCtrl');

const router = express.Router();

router.get('/annualPayrollSummary/:year', statsCtrl.getAnnualPayrollSummary);
router.get('/incomeSummary', statsCtrl.getIncomeSummary);
router.get('/incomes', statsCtrl.getIncomeStats);
module.exports = router;
