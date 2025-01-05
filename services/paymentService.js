

const paypal = require('@paypal/checkout-server-sdk');
const StandardItem = require('../models/StandardItem');
const Task = require('../models/Task');
const VAT_RATE = 0.2; // 20% VAT rate

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY); // Pass the API key here

const calculateTotalPrice = async (taskId) => {
    const task = await Task.findById(taskId);
    if (!task) throw new Error('Task not found');

    let basePrice = task.price || 0; // Price excluding VAT
    let additionalFees = 0; // Track additional fees
    let discount = 0; // Track discounts
    let finalPrice = basePrice;

    const breakdown = [];

    // Apply additional fees based on Objectsposition
    if (task.Objectsposition === "insideWithDismantling") {
        additionalFees += 18; // £18 fee for dismantling
        breakdown.push({
            description: "Dismantling fee (insideWithDismantling)",
            amount: 18,
        });
    } else if (task.Objectsposition === "Inside") {
        additionalFees += 6; // £6 fee for inside without dismantling
        breakdown.push({
            description: "Inside fee",
            amount: 6,
        });
    }

    // Apply discounts for "AnyTime" time slot and "Outside" position
    if (task.Objectsposition === "Outside" && task.available === "AnyTime") {
        discount = basePrice * 0.1; // 10% discount
        breakdown.push({
            description: "10% discount for 'Outside' and 'AnyTime'",
            amount: -discount.toFixed(2),
        });
        finalPrice -= discount;
    }

    // Add additional fees
    finalPrice += additionalFees;

    // Calculate VAT
    const vat = finalPrice * VAT_RATE;
    breakdown.push({
        description: "VAT (20%)",
        amount: vat.toFixed(2),
    });

    finalPrice += vat;

    // Ensure minimum fee of £30 (3000 cents)
    if (finalPrice < 30) {
        const adjustment = 30 - finalPrice;
        finalPrice = 30;
        breakdown.push({
            description: "Minimum fee adjustment",
            amount: adjustment.toFixed(2),
        });
    }

    // Final price
    breakdown.push({
        description: "Final total price",
        amount: finalPrice.toFixed(2),
    });

    return {
        total: Math.round(finalPrice * 100), // Convert to cents for payment processing
        breakdown, // Include detailed breakdown
    };
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

const createStripePaymentLink = async (taskId, amount, initialPrice, breakdown = []) => {
    // Construct description with breakdown details if available
    const description = breakdown.length
        ? breakdown
              .map(item => `${item.description}: £${item.amount}`)
              .join(', ')
        : `Initial price: £${(initialPrice / 100).toFixed(2)}`;

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: 'gbp',
                    product_data: {
                        name: `Payment for Task #${taskId}`,
                        description, // Use only the formatted description here
                    },
                    unit_amount: amount, // amount in pence
                },
                quantity: 1,
            },
        ],
        mode: 'payment',
        metadata: {
            taskId,
            breakdown: JSON.stringify(breakdown || []), // Add detailed breakdown as metadata
            initialPrice: (initialPrice / 100).toFixed(2),
        },
        success_url:
            'https://3299-197-2-227-90.ngrok-free.app/api/webhooks/payment/success',
        cancel_url:
            'https://3299-197-2-227-90.ngrok-free.app/api/webhooks/payment/cancel',
    });

    return session.url; // Return the Stripe checkout URL
};



const createPaypalPaymentLink = async (taskId, amount, initialPrice, breakdown = [], taskDetails) => {
    const environment = new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
    );
    const client = new paypal.core.PayPalHttpClient(environment);

    const taskDescription = `
    Initial Price: £${(initialPrice / 100).toFixed(2)}, 
    Final Price: £${(amount / 100).toFixed(2)},
    Position: ${taskDetails.Objectsposition || "N/A"},
    Time Slot: ${taskDetails.available || "N/A"}
`.trim(); // Limitez à 127 caractères


    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
        intent: "CAPTURE",
        purchase_units: [
            {
                custom_id: taskId,
                //description: taskDescription,
                amount: {
                    currency_code: "GBP",
                    value: (amount / 100).toFixed(2),
                },
            },
        ],
        application_context: {
            return_url: `https://3299-197-2-227-90.ngrok-free.app/api/webhooks/payment/success`,
            cancel_url: `https://3299-197-2-227-90.ngrok-free.app/api/webhooks/payment/cancel`,
        },
    });

    const order = await client.execute(request);
    return order.result.links.find((link) => link.rel === "approve").href;
};

// Fetch PayPal Order Details
const getPayPalOrderDetails = async (orderId) => {
    const environment = new paypal.core.SandboxEnvironment(
      process.env.PAYPAL_CLIENT_ID,
      process.env.PAYPAL_CLIENT_SECRET
    );
    const client = new paypal.core.PayPalHttpClient(environment);
  
    const request = new paypal.orders.OrdersGetRequest(orderId);
    const response = await client.execute(request);
    return response.result;
  };
  
  // Capture PayPal Payment
  const capturePayPalPayment = async (orderId) => {
    const environment = new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
    );
    const client = new paypal.core.PayPalHttpClient(environment);

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({}); // PayPal requires an empty request body for capture

    try {
        const captureResponse = await client.execute(request);
        return captureResponse.result;
    } catch (error) {
        console.error("Error capturing PayPal payment:", error);
        throw error;
    }
};


  
function PayPalClient() {
    return new paypal.core.PayPalHttpClient(
        new paypal.core.SandboxEnvironment(
            process.env.PAYPAL_CLIENT_ID,
            process.env.PAYPAL_CLIENT_SECRET
        )
    );
}

async function testPayPal() {
    const client = PayPalClient();
    const request = new paypal.orders.OrdersCreateRequest();
    request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'GBP', value: '1.00' } }]
    });

    try {
        const response = await client.execute(request);
        console.log('PayPal Test Successful:', response);
    } catch (error) {
        console.error('PayPal Test Failed:', error.message);
    }
}

//testPayPal();




module.exports = {getPayPalOrderDetails,calculateTotalPrice,createStripePaymentIntent,capturePayPalPayment ,createPayPalOrder, PayPalClient,createStripePaymentLink, createPaypalPaymentLink};