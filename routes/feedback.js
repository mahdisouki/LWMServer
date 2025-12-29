const express = require('express');
const router = express.Router();
const feedbackCtrl = require('../controllers/feedbackCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const multer = require('../middlewares/multer'); // Your multer config for Cloudinary

// Routes
router.post('/', multer.single('image'), feedbackCtrl.createFeedback);
router.get('/', feedbackCtrl.getAllFeedbacks);
router.get('/admin/all', feedbackCtrl.getAllFeedbacksForAdmin);
router.post('/send-review-email', isAuth, feedbackCtrl.sendReviewEmail);
router.get('/:id', feedbackCtrl.getFeedbackById);
router.put('/:id', multer.single('image'), feedbackCtrl.updateFeedback);
router.delete('/:id', isAuth, feedbackCtrl.deleteFeedback);



module.exports = router;
