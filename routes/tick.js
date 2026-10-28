const express = require('express');
const router = express.Router();
const tickCtrl = require('../controllers/tickCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

function checkTicksPermission(action) {
  return (req, res, next) => {
    const userPermissions = req.user?.permissions?.Ticks || [];
    if (!userPermissions.includes(action)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: You do not have ${action} permission for Ticks`,
      });
    }
    next();
  };
}

const admin = [isAuth, checkRole('Admin')];
const canView = [...admin, checkTicksPermission('View')];
const canEdit = [...admin, checkTicksPermission('Edit')];

router.get('/', ...canView, tickCtrl.getTickList);
router.patch('/:taskId/note', ...canEdit, tickCtrl.updateTaskNote);

module.exports = router;
