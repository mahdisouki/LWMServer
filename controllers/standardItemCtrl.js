const StandardItem = require('../models/StandardItem');
const ServiceCategory = require('../models/ServiceCategory.js');
const mongoose = require('mongoose');
const { normalizeForSlugCompare } = require('../utils/slug');
const { isPopularityStale } = require('../services/popularityService');
const {
  sortItemsByPopularity,
  defaultItemSort,
} = require('../utils/itemPopularitySort');
const {
  calculateTotalPrice,
  createStripePaymentIntent,
  createPayPalOrder,
} = require('../services/paymentService.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
const { PayPalClient } = require('../services/paymentService.js');
const loggingService = require('../services/loggingService');
const {
  VISIBLE_ITEMS_FILTER,
  buildVisibleItemsCsv,
} = require('../utils/standardItemsExport');

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
  *   1) How often they are ordered (times ordered)
  *   2) Then by how many units are sold in total (totalQuantity)
  *   3) Then by price ascending (cheaper first)
  *   4) Optionally biased by a regex on the item name (e.g. "table"), so
  *      "Dining Table" can suggest "Garden Table", "Bedside Table", etc.
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
      // We no longer limit category-related items; the full category will be returned
      // and sorted. The optional "limit" query param is only used for the global
      // fallback case (when there are no related items in the same category).
      const rawLimit = parseInt(req.query.limit, 12);
      const limit = Number.isNaN(rawLimit) ? null : Math.min(rawLimit, 50);

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

      // Build a simple regex based on the base item's name to bias suggestions
      // towards items with similar names (e.g. anything containing "table").
      // We must escape the keyword to avoid invalid regexes when names contain
      // characters like ")", "(", "+", etc.
      const nameWords = (baseItem.itemName || '')
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      // Prefer a "core" word instead of size adjectives like "small/medium/large"
      // so that "Coffee Machine Small" groups with other coffee machines.
      const sizeWords = ['small', 'medium', 'large', 'xl', 'xxl', 'xs', 'sm', 'md', 'lg'];
      let keyword = null;
      if (nameWords.length) {
        let candidate = nameWords[nameWords.length - 1];
        if (sizeWords.includes(candidate) && nameWords.length > 1) {
          candidate = nameWords[nameWords.length - 2];
        }
        keyword = candidate || nameWords[0];
      }
      const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const safeKeyword = keyword ? escapeRegex(keyword) : null;
      const nameRegex = safeKeyword ? new RegExp(safeKeyword, 'i') : null;

      const pipeline = [
        {
          // Start from all items in the same primary category (except the current one)
          // Regex (if present) is NOT used here to filter items, only for sorting.
          $match: {
            category: primaryCategory,
            isHidden: { $ne: true },
            _id: { $ne: baseItem._id }
          }
        },
        {
          // Popularity from cached fields (updated weekly by cron).
          $addFields: {
            totalQuantity: { $ifNull: ['$purchasedCount', 0] },
            timesOrdered: { $ifNull: ['$timesPurchased', 0] },
            nameMatch: nameRegex
              ? {
                $cond: [
                  {
                    $regexMatch: {
                      input: '$itemName',
                      regex: nameRegex
                    }
                  },
                  1,
                  0
                ]
              }
              : 0
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
            timesOrdered: 1,
            nameMatch: 1
          }
        },
        {
          $sort: {
            nameMatch: -1,
            timesOrdered: -1,
            totalQuantity: -1,
            price: 1,
            itemName: 1,
          }
        }
      ];

      const items = await StandardItem.aggregate(pipeline);

      // If no related items were found in the same category, fall back to global popular & cheap items
      if (!items.length) {
        // For the global fallback we cap the number of items so we don't
        // return an unbounded list; default is 12, or the optional ?limit.
        const globalLimit = limit && limit > 0 ? limit : 12;

        const globalPipeline = [
          {
            // Global search across all visible items (except the current one);
            // regex is only used later to bias sorting, not to filter items out.
            $match: {
              isHidden: { $ne: true },
              _id: { $ne: baseItem._id }
            }
          },
          {
            $addFields: {
              totalQuantity: { $ifNull: ['$purchasedCount', 0] },
              timesOrdered: { $ifNull: ['$timesPurchased', 0] },
              nameMatch: nameRegex
                ? {
                  $cond: [
                    {
                      $regexMatch: {
                        input: '$itemName',
                        regex: nameRegex
                      }
                    },
                    1,
                    0
                  ]
                }
                : 0
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
              timesOrdered: 1,
              nameMatch: 1
            }
          },
          {
            $sort: {
              nameMatch: -1,
              timesOrdered: -1,
              totalQuantity: -1,
              price: 1,
              itemName: 1,
            }
          },
          { $limit: globalLimit }
        ];

        const fallbackItems = await StandardItem.aggregate(globalPipeline);

        return res.status(200).json({
          message:
            'No related items found in the same category, showing top popular & cheap items instead',
          baseItem: {
            id: baseItem._id,
            itemName: baseItem.itemName
          },
          items: fallbackItems
        });
      }

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
      }

      // Count total matching items
      const total = await StandardItem.countDocuments(filter);

      // Popularity-first default ordering when no explicit sort is requested.
      // Uses cached scores from monthly cron; falls back to newest-first when stale.
      if (!sort) {
        const popularityStale = await isPopularityStale();

        if (!popularityStale) {
          const allItems = await StandardItem.find(filter).populate('category').exec();
          const sortedItems = sortItemsByPopularity(allItems);

          if (isPaginationDisabled) {
            return res.status(200).json({
              message: 'All standard items fetched successfully',
              items: sortedItems,
              meta: {
                currentPage: 1,
                limit: total,
                total,
                count: sortedItems.length,
              },
            });
          }

          const skip = (pageNum - 1) * limitNum;
          const pagedItems = sortedItems.slice(skip, skip + limitNum);

          return res.status(200).json({
            message: 'All standard items fetched successfully',
            items: pagedItems,
            meta: {
              currentPage: pageNum,
              limit: limitNum,
              total,
              count: pagedItems.length,
            },
          });
        }

        sortOption = defaultItemSort;
      }

      const query = StandardItem.find(filter).populate('category').sort(sortOption);

      if (isPaginationDisabled) {
        const items = await query.exec();
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
      }

      const skip = (pageNum - 1) * limitNum;
      const items = await query.skip(skip).limit(limitNum).exec();
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

      const totalItems = await StandardItem.countDocuments(query);
      const popularityStale = await isPopularityStale();

      let items;
      if (popularityStale) {
        items = await StandardItem.find(query)
          .populate('category', 'name')
          .sort(defaultItemSort)
          .skip((page - 1) * limit)
          .limit(limit);
      } else {
        const allItems = await StandardItem.find(query).populate('category', 'name');
        const sortedItems = sortItemsByPopularity(allItems);
        items = sortedItems.slice((page - 1) * limit, page * limit);
      }

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
  /**
   * GET /api/standard/items/export
   * Name and price for all non-hidden standard items (CSV).
   */
  exportVisibleItems: async (req, res) => {
    try {
      const items = await StandardItem.find(VISIBLE_ITEMS_FILTER)
        .select('itemName price')
        .sort({ itemName: 1 })
        .lean();

      const timestamp = new Date().toISOString().slice(0, 10);
      const baseName = `visible-items-${timestamp}`;
      const csv = buildVisibleItemsCsv(items);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${baseName}.csv"`,
      );
      res.send(csv);
    } catch (error) {
      res.status(500).json({
        message: 'Failed to export visible items',
        error: error.message,
      });
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
