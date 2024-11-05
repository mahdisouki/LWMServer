    // routes/blogRoutes.js
    const express = require('express');
    const router = express.Router();
    const blogCtrl = require('../controllers/blogCtrl');
    const { isAuth } = require('../middlewares/auth');
    const multer = require('../middlewares/multer'); // Your multer config for Cloudinary

    // Routes
    router.post('/', isAuth, multer.single('image'), blogCtrl.createBlog);
    router.get('/', blogCtrl.getAllBlogs);
    router.get('/:id', blogCtrl.getBlogById);
    router.put('/:id', isAuth, multer.single('image'), blogCtrl.updateBlog);
    router.delete('/:id', isAuth, blogCtrl.deleteBlog);

    module.exports = router;
