const StandardItem = require('../models/StandardItem');
const ServiceCategory = require('../models/ServiceCategory.js')
const mongoose = require('mongoose')
const {
  calculateTotalPrice,
  createStripePaymentIntent,
  createPayPalOrder,
} = require('../services/paymentService.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
const { PayPalClient } = require('../services/paymentService.js');

const standardItemCtrl = {
  createStandardItem: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Image file is required' });
      }
      const { itemName, price, category, description } = req.body;
      const image = req.file.path;
      const newStandardItem = new StandardItem({
        itemName,
        image,
        price,
        category,
        description,
      });
      await newStandardItem.save();
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

  getAllStandardItems: async (req, res) => {
    try {
      const { page = 1, limit = 9 } = req.query;

      let query = StandardItem.find()
        .sort('-createdAt _id')
        .populate('category');

      const total = await StandardItem.countDocuments();

      const skip = (page - 1) * limit;
      const items = await query.skip(skip).limit(Number(limit)).exec();

      res.status(200).json({
        message: 'All standard items fetched successfully',
        items,
        meta: {
          currentPage: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total,
          count: items.length,
        },
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to get standard items',
        error: error.message,
      });
    }
  },

  getItemsByCategory: async (req, res) => {
    const { category } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 9;

    // Validate if category is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(category)) {
      return res.status(400).json({ message: 'Invalid category ID' });
    }

    try {

      const items = await StandardItem.find({ category: category })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('category', 'name');

      const totalItems = await StandardItem.countDocuments({ category: category });


      if (items.length === 0) {
        return res
          .status(404)
          .json({ message: 'No standard items found in this category' });
      }


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
      console.error('Error fetching items by category:', error);
      res.status(500).json({
        message: 'Failed to fetch items by category',
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
    const { id } = req.params;
    const { itemName, price, category, description } = req.body; // Inclure description

    try {
      // Récupérer d'abord l'item existant pour conserver l'image si aucune nouvelle n'est fournie
      const item = await StandardItem.findById(id);
      if (!item) {
        return res.status(404).json({ message: 'Standard item not found' });
      }

      // Définir l'image à l'image existante si aucune nouvelle image n'est fournie
      const image = req.file ? req.file.path : item.image;

      // Mise à jour de l'item avec les nouvelles valeurs, en conservant l'image existante si nécessaire
      const updatedItem = await StandardItem.findByIdAndUpdate(
        id,
        { itemName, price, category, image, description },
        { new: true },
      );

      if (!updatedItem) {
        return res.status(404).json({ message: 'Standard item not found' });
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
      const item = await StandardItem.findByIdAndDelete(id);
      if (!item) {
        return res.status(404).json({ message: 'Standard item not found' });
      }
      res.status(200).json({ message: 'Standard item deleted successfully' });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to delete standard item',
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
  }

};

module.exports = standardItemCtrl;
