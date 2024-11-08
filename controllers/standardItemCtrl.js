const StandardItem = require('../models/StandardItem');
const { calculateTotalPrice, createStripePaymentIntent, createPayPalOrder } = require('../services/paymentService.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
const { PayPalClient } = require('../services/paymentService.js');

const standardItemCtrl = {
    createStandardItem: async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ message: "Image file is required" });
            }
            const { itemName, price , category, description } = req.body; 
            const image = req.file.path;
            const newStandardItem = new StandardItem({ itemName, image, price, category, description });
            await newStandardItem.save();
            res.status(201).json(newStandardItem);
        } catch (error) {
            res.status(500).json({ message: "Failed to create standard item", error: error.message });
        }
    },
    
    getAllStandardItems: async (req, res) => {
        try {
            const items = await StandardItem.find();
            res.status(200).json(items);
        } catch (error) {
            res.status(500).json({ message: "Failed to get standard items", error: error.message });
        }
    },

    getItemsByCategory: async (req, res) => {
        const { category } = req.params;
        try {
            const items = await StandardItem.find({ category: category });
            if (items.length === 0) {
                return res.status(404).json({ message: "No standard items found in this category" });
            }
            res.status(200).json(items);
        } catch (error) {
            res.status(500).json({ message: "Failed to fetch items by category", error: error.message });
        }
    },

    getStandardItemById: async (req, res) => {
        const { id } = req.params;
        try {
            const item = await StandardItem.findById(id);
            if (!item) {
                return res.status(404).json({ message: "Standard item not found" });
            }
            res.status(200).json(item);
        } catch (error) {
            res.status(500).json({ message: "Failed to get standard item", error: error.message });
        }
    },

    updateStandardItem: async (req, res) => {
        const { id } = req.params;
        const { itemName, price, category, description } = req.body; 
    
        try {
            const item = await StandardItem.findById(id);
            if (!item) {
                return res.status(404).json({ message: "Standard item not found" });
            }
    
            const image = req.file ? req.file.path : item.image;
    
            const updatedItem = await StandardItem.findByIdAndUpdate(
                id, 
                { itemName, price, category, image, description },
                { new: true }
            );
    
            if (!updatedItem) {
                return res.status(404).json({ message: "Standard item not found" });
            }
            res.status(200).json(updatedItem);
        } catch (error) {
            res.status(500).json({ message: "Failed to update standard item", error: error.message });
        }
    },
    
    deleteStandardItem: async (req, res) => {
        const { id } = req.params;
        try {
            const item = await StandardItem.findByIdAndDelete(id);
            if (!item) {
                return res.status(404).json({ message: "Standard item not found" });
            }
            res.status(200).json({ message: "Standard item deleted successfully" });
        } catch (error) {
            res.status(500).json({ message: "Failed to delete standard item", error: error.message });
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
    
};

module.exports = standardItemCtrl;
