const express = require('express');
const router = express.Router();
const labelingCtrl = require('../controllers/labelingCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

function checkLabelingPermission(action) {
  return (req, res, next) => {
    const userPermissions = req.user?.permissions?.Labeling || [];
    if (!userPermissions.includes(action)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: You do not have ${action} permission for Labeling`,
      });
    }
    next();
  };
}

const admin = [isAuth, checkRole('Admin')];
const canView = [...admin, checkLabelingPermission('View')];
const canEdit = [...admin, checkLabelingPermission('Edit')];
const canDelete = [...admin, checkLabelingPermission('Delete')];

router.get('/', ...canView, labelingCtrl.getJobs);
router.get('/next', ...canView, labelingCtrl.getNextJob);
router.get('/classes', ...canView, labelingCtrl.getClasses);
router.post('/classes', ...canEdit, labelingCtrl.createClass);
router.post('/sync', ...canEdit, labelingCtrl.syncFromQuotations);
router.get('/export', ...canView, labelingCtrl.exportDataset);
router.get('/labeled', ...canView, labelingCtrl.getLabeledImages);
router.post('/labeled/:id/unlabel', ...canDelete, labelingCtrl.unlabelLabeledImage);
router.post('/labeled/:id', ...canEdit, labelingCtrl.updateLabeledImage);
router.get('/:id', ...canView, labelingCtrl.getJobById);
router.post('/:id/predict', ...canEdit, labelingCtrl.predictJob);
router.post('/:id/save', ...canEdit, labelingCtrl.saveJob);
router.post('/:id/skip', ...canEdit, labelingCtrl.skipJob);
router.post('/:id/unlabel', ...canDelete, labelingCtrl.unlabelJob);

module.exports = router;
