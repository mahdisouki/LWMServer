const express = require('express');
const router = express.Router();
const tickCtrl = require('../controllers/tickCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

router.get('/', isAuth, checkRole('Admin'), tickCtrl.getTickList);
router.patch(
  '/:taskId/note',
  isAuth,
  checkRole('Admin'),
  tickCtrl.updateTaskNote
);

module.exports = router;
