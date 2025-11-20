const express = require('express');
const router = express.Router();
const announcementCtrl = require('../controllers/announcementCtrl');
const { isAuth } = require('../middlewares/auth');

// CRUD routes for announcements
router.post('/', isAuth, announcementCtrl.createAnnouncement);
router.get('/', announcementCtrl.getAllAnnouncements);
router.get('/:id', announcementCtrl.getAnnouncementById);
router.put('/:id', isAuth, announcementCtrl.updateAnnouncement);
router.delete('/:id', isAuth, announcementCtrl.deleteAnnouncement);

module.exports = router;

