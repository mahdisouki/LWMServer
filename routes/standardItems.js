/**
 * @swagger
 * components:
 *   schemas:
 *     StandardItem:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: The auto-generated ID of the standard item
 *         itemName:
 *           type: string
 *           description: The name of the item
 *         image:
 *           type: string
 *           description: URL of the item image
 *         price:
 *           type: number
 *           description: Price of the item
 *         category:
 *           type: array
 *           items:
 *             type: string
 *           description: Categories of the item
 *         description:
 *           type: string
 *           description: Description of the item
 */

/**
 * @swagger
 * /api/standard/standard:
 *   get:
 *     summary: Retrieve all standard items with pagination
 *     tags: [Standard Items]
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
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: A list of standard items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/StandardItem'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     totalItems:
 *                       type: integer
 *                     currentPage:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       500:
 *         description: Failed to get standard items
 */

/**
 * @swagger
 * /api/standard/category/{category}:
 *   get:
 *     summary: Retrieve standard items by category with pagination
 *     tags: [Standard Items]
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema:
 *           type: string
 *         description: Category to filter items
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: A list of standard items in the specified category
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/StandardItem'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     totalItems:
 *                       type: integer
 *                     currentPage:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       404:
 *         description: No standard items found in this category
 *       500:
 *         description: Failed to fetch items by category
 */

/**
 * @swagger
 * /api/standard/{id}:
 *   get:
 *     summary: Retrieve a standard item by ID
 *     tags: [Standard Items]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the standard item
 *     responses:
 *       200:
 *         description: Standard item found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StandardItem'
 *       404:
 *         description: Standard item not found
 *       500:
 *         description: Failed to get standard item
 */


const express = require('express');
const router = express.Router();
const standardItemCtrl = require('../controllers/standardItemCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const multer = require('../middlewares/multer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Configure multer for different upload scenarios
const uploadMainImage = multer.single('image');
const uploadAdditionalImages = multer.array('images', 5); // Allow up to 5 additional images

// Create standard item with main image
router.post('/item', 
  isAuth, 
  checkRole('Admin'), 
  uploadMainImage, 
  standardItemCtrl.createStandardItem
);

// Get all standard items
router.get('/items', standardItemCtrl.getAllStandardItems);

// Get items by category
router.get('/items/category/:category', standardItemCtrl.getItemsByCategory);

// Get item by ID
router.get('/items/:id', standardItemCtrl.getStandardItemById);

// Update standard item (main image)
router.put('/items/:id', 
  isAuth, 
  checkRole('Admin'), 
  uploadMainImage, 
  standardItemCtrl.updateStandardItem
);

// Add additional images to standard item
router.post('/items/:id/images',
  isAuth,
  checkRole('Admin'),
  uploadAdditionalImages,
  standardItemCtrl.addAdditionalImages
);

// Delete additional image from standard item
router.delete('/items/:id/images/:imageIndex',
  isAuth,
  checkRole('Admin'),
  standardItemCtrl.deleteAdditionalImage
);

// Delete standard item
router.delete('/items/:id', 
  isAuth, 
  checkRole('Admin'), 
  standardItemCtrl.deleteStandardItem
);

// Convert category to references
router.put("/convert", standardItemCtrl.convertCategoryToReferences);

// router.post('/pay',    standardItemCtrl.processPayment);
// router.post('/checkoutStripe',    standardItemCtrl.confirmStripePayment);
// router.post('/checkoutPaypal',    standardItemCtrl.capturePayPalOrder);
module.exports = router;
