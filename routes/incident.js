const express = require('express');
const router = express.Router();

const incidentCtrl = require('../controllers/incidentCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const multer = require('../middlewares/multer');

const incidentMediaFields = [
  { name: 'photos', maxCount: 20 }, // backwards compatibility
  { name: 'vehicleMedia', maxCount: 20 },
  { name: 'otherVehicleMedia', maxCount: 20 },
  { name: 'otherLicenseMedia', maxCount: 20 },
  { name: 'breakdownMedia', maxCount: 20 },
];

// Admin: create a new incident/breakdown record for any truck/driver/helper
// Accepts photos uploaded via Cloudinary (field name: "photos")
router.post(
  '/incidents',
  isAuth,
  checkRole('Admin'),
  multer.fields(incidentMediaFields),
  incidentCtrl.createIncidentAdmin
);

// Staff (driver/helper): create a new incident/breakdown record linked to the logged-in user
// Accepts photos uploaded via Cloudinary (field name: "photos")
// This mirrors how other driver mobile routes are prefixed with /driver/...
router.post(
  '/driver/incidents',
  isAuth,
  multer.fields(incidentMediaFields),
  incidentCtrl.createIncident
);

// List incidents – admin view for notifications page
router.get('/incidents', isAuth, checkRole('Admin'), incidentCtrl.listIncidents);

// Get a single incident with full procedure
router.get('/incidents/:incidentId', isAuth, incidentCtrl.getIncidentById);

// Update base incident info and optionally append new photos (admin-only).
// Accepts files via Cloudinary (photos, vehicleMedia, otherVehicleMedia, otherLicenseMedia, breakdownMedia)
router.put(
  '/incidents/:incidentId',
  isAuth,
  checkRole('Admin'),
  multer.fields(incidentMediaFields),
  incidentCtrl.updateIncident
);

// Update a specific step (status and data) – steps can be completed in any order
router.patch(
  '/incidents/:incidentId/steps/:stepId',
  isAuth,
  checkRole('Admin'),
  incidentCtrl.updateStep
);

// Delete an incident (admin-only)
router.delete(
  '/incidents/:incidentId',
  isAuth,
  checkRole('Admin'),
  incidentCtrl.deleteIncident
);

module.exports = router;


