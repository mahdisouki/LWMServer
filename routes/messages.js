const express = require('express');
const router = express.Router();
const { isAuth } = require('../middlewares/auth');
const messageController = require('../controllers/messagesCtrl');

router.get('/driver/messages/helper', isAuth, messageController.getMessagesWithHelper);
router.get('/helper/messages/driver', isAuth, messageController.getMessagesWithDriver);

// Routes pour les messages vocaux
router.post('/voice', isAuth, messageController.sendVoiceMessage);
router.get('/voice/:roomId', isAuth, messageController.getVoiceMessages);
router.delete('/voice/:messageId', isAuth, messageController.deleteVoiceMessage);

router.get('/messages/admin', isAuth, messageController.getMessagesWithAdmin);
router.get('/messages/assigned-helper', isAuth, messageController.getAssignedHelper);
router.get('/messages/assignedHelper/:driverId', isAuth, messageController.getAssignedHelperByDriverId);
router.get('/messages/assigned-driver', isAuth, messageController.getAssignedDriver);
router.get('/messages/assigned-admin', isAuth, messageController.getAdminId);


module.exports = router;
