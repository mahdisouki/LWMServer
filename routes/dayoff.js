const express = require('express');
const router = express.Router();
const dayOffCtrl = require('../controllers/dayOffCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role')


router.get('/dayOff', isAuth, checkRole('Admin'), dayOffCtrl.getAllDayOffRequests);
router.put('/dayOff/:id', isAuth, checkRole('Admin'), dayOffCtrl.updateDayOffRequestStatus);


module.exports = router;
