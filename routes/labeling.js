const express = require('express');
const router = express.Router();
const labelingCtrl = require('../controllers/labelingCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

router.use(isAuth, checkRole('Admin'));

router.get('/', labelingCtrl.getJobs);
router.get('/next', labelingCtrl.getNextJob);
router.get('/classes', labelingCtrl.getClasses);
router.post('/classes', labelingCtrl.createClass);
router.post('/sync', labelingCtrl.syncFromQuotations);
router.get('/export', labelingCtrl.exportDataset);
router.get('/labeled', labelingCtrl.getLabeledImages);
router.post('/labeled/:id/unlabel', labelingCtrl.unlabelLabeledImage);
router.post('/labeled/:id', labelingCtrl.updateLabeledImage);
router.get('/:id', labelingCtrl.getJobById);
router.post('/:id/predict', labelingCtrl.predictJob);
router.post('/:id/save', labelingCtrl.saveJob);
router.post('/:id/skip', labelingCtrl.skipJob);
router.post('/:id/unlabel', labelingCtrl.unlabelJob);

module.exports = router;
