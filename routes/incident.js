const express = require('express');
const router = express.Router();

const incidentCtrl = require('../controllers/incidentCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

// Create a new incident (driver or admin)
router.post('/incidents', isAuth, incidentCtrl.createIncident);

// List incidents – admin view for notifications page
router.get('/incidents', isAuth, checkRole('Admin'), incidentCtrl.listIncidents);

// Get a single incident with full procedure
router.get('/incidents/:incidentId', isAuth, incidentCtrl.getIncidentById);

// Update base incident info
router.put('/incidents/:incidentId', isAuth, checkRole('Admin'), incidentCtrl.updateIncident);

// Update a specific step (status and data) – steps can be completed in any order
router.patch(
  '/incidents/:incidentId/steps/:stepId',
  isAuth,
  checkRole('Admin'),
  incidentCtrl.updateStep
);

// Update incident status (ACTIVE / PENDING_RESOLUTION / RESOLVED)
router.patch(
  '/incidents/:incidentId/status',
  isAuth,
  checkRole('Admin'),
  incidentCtrl.updateStatus
);

module.exports = router;


