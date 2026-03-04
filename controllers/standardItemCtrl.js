const StandardItem = require('../models/StandardItem');
const ServiceCategory = require('../models/ServiceCategory.js');
const Task = require('../models/Task');
const mongoose = require('mongoose');
const { normalizeForSlugCompare } = require('../utils/slug');
const {
  calculateTotalPrice,
  createStripePaymentIntent,
  createPayPalOrder,
} = require('../services/paymentService.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
const { PayPalClient } = require('../services/paymentService.js');
const loggingService = require('../services/loggingService');

// Helper function to get logical sort order for items (smallest to largest)
const SORT_GROUPS = [
  { keys: ['lamp', 'cushion'], base: 100 },
  { keys: ['chair', 'armchair'], base: 200 },
  { keys: ['table', 'desk'], base: 300 },
  { keys: ['sofa'], base: 400 },
  { keys: ['bed', 'mattress'], base: 500 },
  { keys: ['wardrobe', 'drawer'], base: 600 },
  { keys: ['printer', 'tv'], base: 700 },
  { keys: ['fridge', 'freezer'], base: 800 },
  { keys: ['door', 'window', 'radiator'], base: 900 },
  { keys: ['load', 'bin'], base: 1000 },
];

const SIZE_ORDER = [
  ['mini', 1],
  ['small', 2],
  ['single', 2],
  ['standard', 3],
  ['medium', 3],
  ['double', 4],
  ['king', 5],
  ['emperor', 6],
  ['large', 7],
  ['corner', 8],
  ['american', 9],
  ['commercial', 10],
];

const getItemSortOrder = (itemName) => {
  if (!itemName) return 99999;

  const name = itemName.toLowerCase();

  // 1️⃣ Group score
  let base = 9000;
  for (const g of SORT_GROUPS) {
    if (g.keys.some(k => name.includes(k))) {
      base = g.base;
      break;
    }
  }

  // 2️⃣ Size score
  let size = 5;
  for (const [key, val] of SIZE_ORDER) {
    if (name.includes(key)) {
      size = val;
      break;
    }
  }

  // 3️⃣ Seater logic (overrides size)
  const seaterMatch = name.match(/(\d)\s*seater/);
  if (seaterMatch) size = parseInt(seaterMatch[1], 10);

  return base + size;
};


const standardItemCtrl = {
  createStandardItem: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Main image file is required' });
      }

      const { itemName, price, category, description, insidePrice, insideWithDismantlingPrice, Objectsposition, ewcCode, isHidden, spaceOfVan, timespentOutside, timespentInside, timespentInsdiewithDis } = req.body;

      // Main image
      const image = req.file.path;

      // Additional images if any
      const additionalImages = req.files ? req.files.map(file => file.path) : [];

      const newStandardItem = new StandardItem({
        itemName,
        image,
        images: additionalImages,
        price,
        category,
        description,
        insidePrice,
        insideWithDismantlingPrice,
        Objectsposition,
        ewcCode,
        isHidden,
        spaceOfVan,
        timespentOutside,
        timespentInside,
        timespentInsdiewithDis
      });

      await newStandardItem.save();

      // Create a log of the standard item creation
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'CREATE',
          entityType: 'STANDARD_ITEM',
          entityId: newStandardItem._id,
          changes: {
            created: newStandardItem.toObject(),
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      res.status(201).json(newStandardItem);
    } catch (error) {
      res.status(500).json({
        message: 'Failed to create standard item',
        error: error.message,
      });
    }
  },

  // processPayment: async (req, res) => {
  //     const { itemId, options, paymentType } = req.body;

  //     try {
  //         const amount = await calculateTotalPrice(itemId, options); // Montant en centimes pour Stripe et PayPal

  //         let paymentResult;
  //         switch (paymentType) {
  //             case 'stripe':
  //                 paymentResult = await createStripePaymentIntent(amount);
  //                 return res.json({
  //                     message: 'Stripe payment initiated successfully',
  //                     clientSecret: paymentResult.client_secret, // Utilisé pour confirmer le paiement côté client
  //                     paymentIntentId: paymentResult.id, // ID du PaymentIntent, utile pour la confirmation côté serveur
  //                     amount: amount
  //                 });

  //             case 'paypal':
  //                 paymentResult = await createPayPalOrder(amount);
  //                 return res.json({
  //                     message: 'PayPal payment initiated successfully',
  //                     orderID: paymentResult.result.id,
  //                     amount: amount
  //                 });

  //             default:
  //                 return res.status(400).json({ message: "Invalid payment method" });
  //         }
  //     } catch (error) {
  //         console.error('Payment Error:', error);
  //         return res.status(500).json({ message: "Failed to initiate payment", error: error.message });
  //     }
  // },

  // confirmStripePayment: async (req, res) => {
  //     const { paymentIntentId, paymentMethodId } = req.body;

  //     try {
  //         const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
  //             payment_method: paymentMethodId,
  //         });

  //         if (paymentIntent.status === 'succeeded') {
  //             return res.status(200).json({
  //                 message: 'Payment confirmed successfully',
  //                 paymentIntent,
  //             });
  //         } else {
  //             return res.status(400).json({
  //                 message: 'Payment confirmation failed',
  //                 status: paymentIntent.status,
  //             });
  //         }
  //     } catch (error) {
  //         console.error('Error confirming payment:', error);
  //         res.status(500).json({ message: 'Error confirming payment', error: error.message });
  //     }
  // },

  // capturePayPalOrder: async (req, res) => {
  //     const { orderID } = req.body;

  //     try {
  //         // Créer une demande de capture pour PayPal
  //         const request = new paypal.orders.OrdersCaptureRequest(orderID);
  //         request.requestBody({});

  //         // Exécuter la capture via le client PayPal
  //         const capture = await PayPalClient().execute(request);

  //         res.status(200).json({
  //             message: 'PayPal payment captured successfully',
  //             captureDetails: capture.result,
  //         });
  //     } catch (error) {
  //         console.error('Error capturing PayPal payment:', error);
  //         res.status(500).json({
  //             message: 'Failed to capture PayPal payment',
  //             error: error.message,
  //         });
  //     }
  // },

  /**
   * Get all items in the same category, ordered by:
   *   1) How often they are purchased in real orders (tasks)
   *   2) Then by price ascending (cheaper first)
   *
   * This is ideal for a marketing block like "You may also like":
   *  - All items from the category are returned
   *  - The most popular & affordable ones appear at the top
   * Logic:
   *  - Look at completed/paid tasks (orders)
   *  - Count how often each standard item is purchased (quantity + occurrences)
   *  - Join this popularity info onto all items in the same primary category
   *  - Sort by purchase volume (desc), then by price (asc) to surface cheaper options
   * Route example (added in routes/standardItems.js):
   *    GET /api/standard/items/:id/top-related
   *    Optional: ?limit=10 to cap the number of returned items
   */
  getTopRelatedItems: async (req, res) => {
    try {
      const { id } = req.params;
      const rawLimit = parseInt(req.query.limit, 30);
      const limit = Number.isNaN(rawLimit) ? null : Math.min(rawLimit, 50); // optional cap

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Invalid item ID' });
      }

      const baseItem = await StandardItem.findById(id).populate('category');
      if (!baseItem) {
        return res.status(404).json({ message: 'Standard item not found' });
      }

      // Use the first category as the "primary" one for related items
      const categories = Array.isArray(baseItem.category) ? baseItem.category : [];
      if (!categories.length) {
        return res.status(200).json({
          message: 'No category found for this item, cannot compute related items',
          items: []
        });
      }

      const primaryCategory = categories[0]._id || categories[0];

      const pipeline = [
        {
          // Start from all items in the same primary category (except the current one)
          $match: {
            category: primaryCategory,
            isHidden: { $ne: true },
            _id: { $ne: baseItem._id }
          }
        },
        {
          // Lookup popularity information from tasks collection
          $lookup: {
            from: 'tasks',
            let: { itemId: '$_id' },
            pipeline: [
              {
                $match: {
                  paymentStatus: { $in: ['Paid', 'partial_Paid'] },
                  taskStatus: { $ne: 'Cancelled' },
                  'items.standardItemId': { $ne: null }
                }
              },
              { $unwind: '$items' },
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$items.standardItemId', '$$itemId'] },
                      { $ne: ['$items.standardItemId', null] }
                    ]
                  }
                }
              },
              {
                $group: {
                  _id: '$items.standardItemId',
                  totalQuantity: {
                    $sum: {
                      $cond: [
                        { $gt: ['$items.quantity', 0] },
                        '$items.quantity',
                        1
                      ]
                    }
                  },
                  timesOrdered: { $sum: 1 }
                }
              }
            ],
            as: 'popularity'
          }
        },
        {
          // Flatten popularity info and default to 0 when no orders exist
          $addFields: {
            totalQuantity: {
              $ifNull: [{ $arrayElemAt: ['$popularity.totalQuantity', 0] }, 0]
            },
            timesOrdered: {
              $ifNull: [{ $arrayElemAt: ['$popularity.timesOrdered', 0] }, 0]
            }
          }
        },
        {
          $project: {
            _id: 0,
            itemId: '$_id',
            itemName: '$itemName',
            image: '$image',
            price: '$price',
            category: '$category',
            totalQuantity: 1,
            timesOrdered: 1
          }
        },
        {
          $sort: {
            totalQuantity: -1, // most purchased first
            price: 1,          // cheaper first
            itemName: 1        // tie‑breaker
          }
        }
      ];

      // Apply limit only if provided
      if (limit && limit > 0) {
        pipeline.push({ $limit: limit });
      }

      const items = await StandardItem.aggregate(pipeline);

      return res.status(200).json({
        message: 'Top related items fetched successfully',
        baseItem: {
          id: baseItem._id,
          itemName: baseItem.itemName
        },
        items
      });
    } catch (error) {
      console.error('Error getting top related items:', error);
      return res.status(500).json({
        message: 'Failed to get top related items',
        error: error.message
      });
    }
  },

  getAllStandardItems: async (req, res) => {
    try {
      const { page = '1', limit = '9', pagination, category, search = '', sort } = req.query;
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
      const isPaginationDisabled = (pagination === 'false');

      // Build the filter object
      let filter = {};

      // 🔍 Add search condition if provided
      if (search && search.trim()) {
        const searchTerm = search.trim();

        // Normalize text: remove accents/diacritics for better matching
        // e.g., "lampe" matches "lamp" and vice versa
        const normalizeText = (text) => {
          return text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
            .toLowerCase();
        };

        const normalizedSearch = normalizeText(searchTerm);

        // Escape special regex characters
        const escapeRegex = (str) => {
          return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        };

        // Create flexible regex pattern that allows characters in between
        // This enables partial matching like "lamp" matching "lampe"
        const searchRegex = new RegExp(
          escapeRegex(normalizedSearch)
            .split('')
            .join('.*?'), // Allow optional characters between each character
          'i' // case-insensitive
        );

        filter.itemName = {
          $regex: searchRegex
          // Case-insensitive matching is already handled by the 'i' flag in the RegExp
        };
      }

      // Filter by Category if provided
      if (category) {
        if (!mongoose.Types.ObjectId.isValid(category)) {
          return res.status(400).json({ message: 'Invalid category ID' });
        }
        filter.category = category;
      }

      // Determine sort option
      let sortOption = { createdAt: -1, _id: 1 }; // Default: newest first
      let useCustomSort = false; // Flag for custom category-based sorting

      if (sort) {
        switch (sort) {
          case 'name-asc':
            sortOption = { itemName: 1 };
            break;
          case 'name-desc':
            sortOption = { itemName: -1 };
            break;
          case 'price-asc':
            sortOption = { price: 1 };
            break;
          case 'price-desc':
            sortOption = { price: -1 };
            break;
          default:
            sortOption = { createdAt: -1, _id: 1 };
        }
      } else if (category) {
        // When category is selected and no explicit sort, use custom logical sort
        useCustomSort = true;
      }

      // Count total matching items
      const total = await StandardItem.countDocuments(filter);

      // Build the query
      let query = StandardItem.find(filter).populate('category');

      let items;

      if (useCustomSort) {
        // Fetch all items for custom sorting (categories typically don't have many items)
        const allItems = await query.exec();

        // Apply custom logical sorting
        allItems.sort((a, b) => {
          const orderA = getItemSortOrder(a.itemName);
          const orderB = getItemSortOrder(b.itemName);

          // If same order, sort alphabetically
          if (orderA === orderB) {
            return a.itemName.localeCompare(b.itemName);
          }

          return orderA - orderB;
        });

        // Apply pagination after sorting
        if (isPaginationDisabled) {
          items = allItems;
          return res.status(200).json({
            message: 'All standard items fetched successfully',
            items,
            meta: {
              currentPage: 1,
              limit: total,
              total,
              count: items.length
            }
          });
        } else {
          const skip = (pageNum - 1) * limitNum;
          items = allItems.slice(skip, skip + limitNum);
          return res.status(200).json({
            message: 'All standard items fetched successfully',
            items,
            meta: {
              currentPage: pageNum,
              limit: limitNum,
              total,
              count: items.length
            }
          });
        }
      } else {
        // Normal sorting (use MongoDB sort)
        query = query.sort(sortOption);

        if (isPaginationDisabled) {
          items = await query.exec();
          return res.status(200).json({
            message: 'All standard items fetched successfully',
            items,
            meta: {
              currentPage: 1,
              limit: total,
              total,
              count: items.length
            }
          });
        } else {
          const skip = (pageNum - 1) * limitNum;
          items = await query.skip(skip).limit(limitNum).exec();
          return res.status(200).json({
            message: 'All standard items fetched successfully',
            items,
            meta: {
              currentPage: pageNum,
              limit: limitNum,
              total,
              count: items.length
            }
          });
        }
      }
    } catch (error) {
      console.error('Error fetching standard items:', error);
      res.status(500).json({
        message: 'Failed to get standard items',
        error: error.message
      });
    }
  },


  getItemsByCategory: async (req, res) => {
    const { category } = req.params; // Category parameter from the route
    const page = parseInt(req.query.page, 10) || 1; // Default page is 1
    const limit = parseInt(req.query.limit, 10) || 9; // Default limit is 9
    console.log('entered')
    try {
      // Define the query dynamically
      let query = {};
      if (category) {

        // Validate category only if it's provided
        if (!mongoose.Types.ObjectId.isValid(category)) {
          return res.status(400).json({ message: 'Invalid category ID' });
        }
        query.category = category; // Add category filter to the query
      }

      // Fetch items based on the query
      const items = await StandardItem.find(query)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('category', 'name'); // Populate category details

      // Count total items based on the query
      const totalItems = await StandardItem.countDocuments(query);

      if (items.length === 0) {
        return res.status(404).json({ message: 'No standard items found' });
      }

      // Return paginated response
      res.status(200).json({
        message: 'Standard items fetched successfully',
        items,
        meta: {
          currentPage: page,
          limit,
          total: totalItems,
          totalPages: Math.ceil(totalItems / limit),
        },
      });
    } catch (error) {
      console.error('Error fetching items:', error);
      res.status(500).json({
        message: 'Failed to fetch items',
        error: error.message,
      });
    }
  },



  getStandardItemById: async (req, res) => {
    const { id } = req.params;
    try {
      const item = await StandardItem.findById(id).populate('category');
      if (!item) {
        return res.status(404).json({ message: 'Standard item not found' });
      }
      res.status(200).json(item);
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to get standard item', error: error.message });
    }
  },

  updateStandardItem: async (req, res) => {
    try {
      const { itemName, price, category, description, insidePrice, insideWithDismantlingPrice, Objectsposition, ewcCode, isHidden, spaceOfVan, timespentOutside, timespentInside, timespentInsdiewithDis } = req.body;

      const updateData = {
        itemName,
        price,
        category,
        description,
        insidePrice,
        insideWithDismantlingPrice,
        Objectsposition,
        ewcCode,
        isHidden,
        spaceOfVan,
        timespentOutside,
        timespentInside,
        timespentInsdiewithDis
      };

      // Get existing item
      const oldStandardItem = await StandardItem.findById(req.params.id);
      if (!oldStandardItem) {
        return res.status(404).json({ message: 'Standard item not found' });
      }

      // Update main image if provided
      if (req.file) {
        updateData.image = req.file.path;
      }

      // Add new additional images if provided
      if (req.files && req.files.length > 0) {
        const newImages = req.files.map(file => file.path);
        updateData.images = [...oldStandardItem.images, ...newImages];
      }

      const updatedItem = await StandardItem.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true, runValidators: true }
      );

      // Create a log of the changes
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'UPDATE',
          entityType: 'STANDARD_ITEM',
          entityId: req.params.id,
          changes: {
            before: oldStandardItem.toObject(),
            after: updatedItem.toObject(),
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      res.status(200).json(updatedItem);
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update standard item',
        error: error.message,
      });
    }
  },

  deleteStandardItem: async (req, res) => {
    const { id } = req.params;
    try {
      const item = await StandardItem.findById(id);
      if (!item) {
        return res.status(404).json({ message: 'Standard item not found' });
      }

      // Create a log of the deletion before actually deleting
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'DELETE',
          entityType: 'STANDARD_ITEM',
          entityId: id,
          changes: {
            deleted: item.toObject(),
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      await StandardItem.findByIdAndDelete(id);
      res.status(200).json({ message: 'Standard item deleted successfully' });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to delete standard item',
        error: error.message,
      });
    }
  },

  // Add additional images to standard item
  addAdditionalImages: async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No images provided' });
      }

      const standardItem = await StandardItem.findById(req.params.id);
      if (!standardItem) {
        return res.status(404).json({ message: 'Standard item not found' });
      }

      const newImages = req.files.map(file => file.path);
      standardItem.images = [...standardItem.images, ...newImages];
      await standardItem.save();

      res.status(200).json({
        message: 'Additional images added successfully',
        standardItem
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to add additional images',
        error: error.message,
      });
    }
  },

  // Delete additional image from standard item
  deleteAdditionalImage: async (req, res) => {
    try {
      const { itemId, imageIndex } = req.params;

      const standardItem = await StandardItem.findById(itemId);
      if (!standardItem) {
        return res.status(404).json({ message: 'Standard item not found' });
      }

      // Check if image index is valid
      if (imageIndex < 0 || imageIndex >= standardItem.images.length) {
        return res.status(400).json({ message: 'Invalid image index' });
      }

      // Remove the image at the specified index
      standardItem.images.splice(imageIndex, 1);
      await standardItem.save();

      res.status(200).json({
        message: 'Additional image deleted successfully',
        standardItem
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to delete additional image',
        error: error.message,
      });
    }
  },

  convertCategoryToReferences: async (req, res) => {
    try {
      // Fetch all service categories
      const categories = await ServiceCategory.find({});

      // Create a mapping from category name to ObjectId
      const categoryMap = categories.reduce((acc, category) => {
        acc[category.name] = category._id;
        return acc;
      }, {});

      // Fetch all standard items that still have category names as strings
      const standardItems = await StandardItem.find();

      // Iterate through each standard item and update category references
      for (const item of standardItems) {
        // Map each category name to its corresponding ObjectId
        const updatedCategories = item.category.map(categoryName => categoryMap[categoryName]);

        // Update the standard item with the ObjectId references in the category field
        await StandardItem.updateOne(
          { _id: item._id },
          { $set: { category: updatedCategories } }
        );
      }

      console.log('Standard items updated successfully');
    } catch (error) {
      console.error('Error updating categories:', error);
    }
  },
  // Add this after getStandardItemById
  getStandardItemBySlug: async (req, res) => {
    const { slug } = req.params;
    try {
      // Normalize incoming slug for comparison
      const target = normalizeForSlugCompare(slug);

      // Fetch all items and find the one with matching normalized name
      const items = await StandardItem.find({}).populate('category');

      let matchedItem = null;
      for (const item of items) {
        const normalizedName = normalizeForSlugCompare(item.itemName);
        if (normalizedName === target) {
          matchedItem = item;
          break;
        }
      }

      if (!matchedItem) {
        console.log('standard item not found for slug:', slug);
        console.log('normalized target:', target);
        const sample = items.slice(0, 5).map((i) => ({
          name: i.itemName,
          normalized: normalizeForSlugCompare(i.itemName),
        }));
        console.log('sample normalized item names:', sample);
        return res.status(404).json({ message: 'Standard item not found' });
      }

      res.status(200).json(matchedItem);
    } catch (error) {
      res.status(500).json({
        message: 'Failed to get standard item',
        error: error.message,
      });
    }
  },

};

module.exports = standardItemCtrl;
