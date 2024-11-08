
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
const StandardItem = require('../models/StandardItem');
const Task = require('../models/Task');

const VAT_RATE = 0.2; // 20% VAT rate


const calculateTotalPrice = async (taskId, options) => {
    const task = await Task.findById(taskId);
    if (!task) throw new Error('Task not found');

    let totalPrice = task.price || 0; // Price excluding VAT

    // Apply additional fees based on options
    if (options) {
        if (options.position === "insideWithDismantling") {
            totalPrice += 18; // £18 fee for dismantling
        } else if (options.position === "Inside") {
            totalPrice += 6; // £6 fee for inside without dismantling
        } else if (options.position === "Outside") {
            // Apply 10% discount if outside and selected "Any Time" slot
            if (options.timeSlot === "AnyTime") {
                totalPrice *= 0.9;
            }
        }
    }

    // Calculate VAT
    totalPrice = totalPrice * (1 + VAT_RATE);

    // Ensure minimum fee of £30 (3000 cents)
    if (totalPrice < 30) {
        totalPrice = 30;
    }

    return Math.round(totalPrice * 100); // Convert to cents for payment processing
};



const createStripePaymentIntent = async (amount) => {
    return stripe.paymentIntents.create({
        amount: amount, 
        currency: 'gbp',
        payment_method_types: ['card'],
    });
};


async function createPayPalOrder(amount) {
    const client = PayPalClient();
    const request = new paypal.orders.OrdersCreateRequest();
    request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'GBP', value: (amount / 100).toFixed(2) } }]
    });
    return client.execute(request);
}

module.exports = { createPayPalOrder, PayPalClient };



// Fonction pour configurer l'environnement sandbox ou live
function environment() {
    let clientId = process.env.PAYPAL_CLIENT_ID;
    let clientSecret = process.env.PAYPAL_SECRET;

    return new paypal.core.SandboxEnvironment(clientId, clientSecret); // Utilisez LiveEnvironment en production
}




function PayPalClient() {
    return new paypal.core.PayPalHttpClient(new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_SECRET
    ));
}



module.exports = {
    calculateTotalPrice,
    createStripePaymentIntent,
    createPayPalOrder,
    PayPalClient
};
