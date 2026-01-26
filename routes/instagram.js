const express = require('express');
const router = express.Router();
const instagramCtrl = require('../controllers/instagramCtrl');
const { isAuth } = require('../middlewares/auth');

// Get Instagram posts
router.get('/posts', instagramCtrl.getInstagramPosts);

// Manual token refresh endpoint (optional - cron handles auto-refresh)
router.post('/refresh-token', isAuth, instagramCtrl.refreshLongLivedToken);

module.exports = router;
