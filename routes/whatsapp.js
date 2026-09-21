const express = require('express');
const multer = require('multer');
const router = express.Router();
const whatsappCtrl = require('../controllers/whatsappCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');

const admin = [isAuth, checkRole('Admin')];

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/msword' ||
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'text/plain';
    if (ok) cb(null, true);
    else cb(new Error('Unsupported file type for WhatsApp'));
  },
});

// Public Meta webhook (no auth)
router.get('/webhook', whatsappCtrl.verifyWebhook);
router.post('/webhook', whatsappCtrl.receiveWebhook);

router.get('/health', ...admin, whatsappCtrl.health);
router.get('/status', ...admin, whatsappCtrl.getStatus);
router.get('/tasks/search', ...admin, whatsappCtrl.searchTasks);
router.get('/templates', ...admin, whatsappCtrl.listTemplates);

router.get('/conversations', ...admin, whatsappCtrl.listConversations);
router.post('/conversations', ...admin, whatsappCtrl.startConversation);
router.get('/conversations/:id', ...admin, whatsappCtrl.getConversation);
router.get('/conversations/:id/messages', ...admin, whatsappCtrl.listMessages);
router.post('/conversations/:id/messages', ...admin, whatsappCtrl.sendMessage);
router.post(
  '/conversations/:id/media',
  ...admin,
  (req, res, next) => {
    memoryUpload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      next();
    });
  },
  whatsappCtrl.sendMedia
);
router.post('/conversations/:id/read', ...admin, whatsappCtrl.markRead);
router.patch('/conversations/:id/link', ...admin, whatsappCtrl.linkConversation);

router.get('/media/:mediaId', ...admin, whatsappCtrl.getMedia);

module.exports = router;
