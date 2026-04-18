const express = require('express');
const router = express.Router();
const unitAssignmentLogCtrl = require('../controllers/unitAssignmentLogCtrl');

router.get('/unit-assignment-logs', unitAssignmentLogCtrl.getLogsByDate);

module.exports = router;
