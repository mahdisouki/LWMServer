const express = require('express');
const router = express.Router();
const dayOffCtrl = require('../controllers/dayOffCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const upload = require('../middlewares/multer');


router.get('/dayOff', isAuth, checkRole('Admin'), dayOffCtrl.getAllDayOffRequests);
router.get('/userDayOff', isAuth, checkRole('Driver', 'Helper'), dayOffCtrl.getAllDayOffRequestsForUser);
router.post('/dayOff', isAuth, checkRole('Driver', 'Helper'), upload.array('proofs', 10), dayOffCtrl.requestDayOff);
router.put('/dayOff/:id', isAuth, checkRole('Admin'), dayOffCtrl.updateDayOffRequestStatus);
router.put('/dayOff/:requestId/update', isAuth, checkRole('Driver', 'Helper'), upload.array('proofs', 10), dayOffCtrl.updateDayOffRequest);
router.post('/dayOff/:id/create', isAuth, checkRole('Admin'), upload.array('proofs', 10), dayOffCtrl.addDayOffForUser);

module.exports = router;
