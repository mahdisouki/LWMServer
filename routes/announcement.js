const express = require('express');
const router = express.Router();
const announcementCtrl = require('../controllers/announcementCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

// CRUD routes for announcements
router.post('/', isAuth, checkRole('Admin'), announcementCtrl.createAnnouncement);
router.get('/', announcementCtrl.getAllAnnouncements);
router.get('/:id', announcementCtrl.getAnnouncementById);
router.put('/:id', isAuth, checkRole('Admin'), announcementCtrl.updateAnnouncement);
router.delete('/:id', isAuth, checkRole('Admin'), announcementCtrl.deleteAnnouncement);

module.exports = router;

