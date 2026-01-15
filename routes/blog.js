
const express = require('express');
const router = express.Router();
const blogCtrl = require('../controllers/blogCtrl');
const { isAuth } = require('../middlewares/auth');
const multer = require('../middlewares/multer'); // Your multer config for Cloudinary   
const { checkRole } = require('../middlewares/role');

// Routes
router.post('/', multer.single('image'), blogCtrl.createBlog);
router.get('/', blogCtrl.getAllBlogs);
router.get('/slug/:slug', blogCtrl.getBlogBySlug);
router.get('/:id', blogCtrl.getBlogById);
router.put('/:id', multer.single('image'), blogCtrl.updateBlog);
router.delete('/:id', blogCtrl.deleteBlog);
router.get('/tag/:tag', blogCtrl.getBlogsByTag);
router.get('/tags/getAllTags', blogCtrl.getAllTags);

module.exports = router;
