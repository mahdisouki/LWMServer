
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
const StandardItem = require('../models/StandardItem');
const Task = require('../models/Task');

const calculateTotalPrice = async (taskId, options) => {
    const task = await Task.findById(taskId);
    if (!task) throw new Error('Task not found');

    let totalPrice = task.price || 0;

    // Apply discounts or additional fees based on options
    if (options && options.position === "Outside") {
        totalPrice *= 0.9; // Apply 10% discount if outside
    }
    if (options && options.needsDismantling) {
        totalPrice += 18; // Additional fee for dismantling
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
