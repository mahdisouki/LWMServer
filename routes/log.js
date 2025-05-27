const express = require('express');
const router = express.Router();
const logCtrl = require('../controllers/logCtrl');


// Get all logs (admin only)
router.get('/logs',logCtrl.getLogs);

// Get logs for a specific entity
router.get('/logs/:entityType/:entityId',  logCtrl.getLogsByEntity);

module.exports = router; 