/**
 * @swagger
 * components:
 *   schemas:
 *     Blog:
 *       type: object
 *       required:
 *         - title
 *         - author
 *         - description
 *         - image
 *       properties:
 *         id:
 *           type: string
 *           description: The auto-generated ID of the blog post
 *         title:
 *           type: string
 *           description: The title of the blog post
 *         author:
 *           type: string
 *           description: The author of the blog post
 *         description:
 *           type: string
 *           description: The description of the blog post
 *         image:
 *           type: string
 *           description: The URL of the blog post image
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: The date the blog post was created
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: The date the blog post was last updated
 */

/**
 * @swagger
 * /api/blog/:
 *   post:
 *     summary: Create a new blog post
 *     tags: [Blog]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               author:
 *                 type: string
 *               description:
 *                 type: string
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Blog post created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Blog'
 *       500:
 *         description: Failed to create blog post
 */

/**
 * @swagger
 * /api/blog/:
 *   get:
 *     summary: Get all blog posts
 *     tags: [Blog]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Limit of items per page
 *     responses:
 *       200:
 *         description: All blogs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 blogs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Blog'
 *                 meta:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     count:
 *                       type: integer
 *       500:
 *         description: Failed to retrieve blogs
 */

/**
 * @swagger
 * /api/blog/{id}:
 *   get:
 *     summary: Get a blog post by ID
 *     tags: [Blog]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The blog post ID
 *     responses:
 *       200:
 *         description: Blog post found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Blog'
 *       404:
 *         description: Blog post not found
 */

/**
 * @swagger
 * /api/blog/{id}:
 *   put:
 *     summary: Update a blog post
 *     tags: [Blog]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The blog post ID
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               author:
 *                 type: string
 *               description:
 *                 type: string
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Blog post updated successfully
 *       404:
 *         description: Blog post not found
 *       500:
 *         description: Failed to update blog post
 */

/**
 * @swagger
 * /api/blog/{id}:
 *   delete:
 *     summary: Delete a blog post
 *     tags: [Blog]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The blog post ID
 *     responses:
 *       200:
 *         description: Blog post deleted successfully
 *       404:
 *         description: Blog post not found
 */

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
router.get('/tag/:tag', blogCtrl.getBlogsByTag);
router.get('/tags/getAllTags', blogCtrl.getAllTags);

module.exports = router;
