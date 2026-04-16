const express = require('express');
const router = express.Router();

const incidentCtrl = require('../controllers/incidentCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const multer = require('../middlewares/multer');
const multerLib = require('multer');

const incidentMediaFields = [
  { name: 'vehicleMedia', maxCount: 20 },
  { name: 'otherVehicleMedia', maxCount: 20 },
  { name: 'otherLicenseMedia', maxCount: 20 },
  { name: 'breakdownMedia', maxCount: 20 },
];

const handleIncidentUpload = (multerMiddleware) => (req, res, next) => {
  const handleUploadError = (err) => {
    if (!err) return next();
    if (res.headersSent) return next(err);

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        message: 'One or more files exceed the 100MB upload limit.',
        code: err.code,
      });
    }

    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        message: `Unexpected upload field: ${err.field || 'unknown'}.`,
        code: err.code,
      });
    }

    if (err instanceof multerLib.MulterError) {
      return res.status(400).json({
        message: 'Incident file upload failed.',
        code: err.code || 'MULTER_ERROR',
      });
    }

    return res.status(400).json({
      message: err.message || 'Incident media upload failed before controller execution.',
      code: 'UPLOAD_ERROR',
    });
  };

  try {
    const maybePromise = multerMiddleware(req, res, handleUploadError);

    // Some storage engines can reject asynchronously instead of using callback.
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise.catch(handleUploadError);
    }
  } catch (err) {
    handleUploadError(err);
  }
};

// Admin: create a new incident/breakdown record for any truck/driver/helper
// Accepts incident media uploaded via Cloudinary
router.post(
  '/incidents',
  isAuth,
  checkRole('Admin'),
  handleIncidentUpload(multer.fields(incidentMediaFields)),
  incidentCtrl.createIncidentAdmin
);

// Staff (driver/helper): create a new incident/breakdown record linked to the logged-in user
// Accepts incident media uploaded via Cloudinary
// This mirrors how other driver mobile routes are prefixed with /driver/...
router.post(
  '/driver/incidents',
  isAuth,
  handleIncidentUpload(multer.fields(incidentMediaFields)),
  incidentCtrl.createIncident
);

// List incidents – admin view for notifications page
router.get('/incidents', isAuth, checkRole('Admin'), incidentCtrl.listIncidents);

// Get van registration for a specific driver and date
router.get('/incidents/get-van', isAuth, incidentCtrl.getVanFromDriverAndDate);

// Get a single incident with full procedure
router.get('/incidents/:incidentId', isAuth, incidentCtrl.getIncidentById);

// Update base incident info and optionally append new media (admin-only).
// Accepts files via Cloudinary (vehicleMedia, otherVehicleMedia, otherLicenseMedia, breakdownMedia)
router.put(
  '/incidents/:incidentId',
  isAuth,
  checkRole('Admin'),
  handleIncidentUpload(multer.fields(incidentMediaFields)),
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


