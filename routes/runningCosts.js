const express = require('express');
const router = express.Router();
const runningCostsCtrl = require('../controllers/runningCostsCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const parser = require('../middlewares/multer');

const admin = [isAuth, checkRole('Admin')];

router.get('/meta', ...admin, runningCostsCtrl.getMeta);
router.get('/', ...admin, runningCostsCtrl.getSummary);
router.post('/manual', ...admin, parser.single('receipt'), runningCostsCtrl.createManual);
router.patch('/manual/:id', ...admin, parser.single('receipt'), runningCostsCtrl.updateManual);
router.delete('/manual/:id', ...admin, runningCostsCtrl.deleteManual);

module.exports = router;
