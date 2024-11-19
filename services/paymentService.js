

const paypal = require('@paypal/checkout-server-sdk');
const StandardItem = require('../models/StandardItem');
const Task = require('../models/Task');
const VAT_RATE = 0.2; // 20% VAT rate

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY); // Pass the API key here

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

const createStripePaymentLink = async (taskId, amount) => {
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: 'gbp',
                    product_data: { name: `Payment for Task #${taskId}` },
                    unit_amount: amount, // amount in pence
                },
                quantity: 1,
            },
        ],
        mode: 'payment',
        metadata: { taskId }, // Add taskId as metadata
        success_url: 'https://efde-197-2-100-22.ngrok-free.app/api/webhooks/payment/success',
        cancel_url: 'https://efde-197-2-100-22.ngrok-free.app/api/webhooks/payment/cancel',
    });
    
    return session.url; // Retournez l'URL générée par Stripe pour le paiement
};


const createPaypalPaymentLink = async (taskId, amount) => {
    const environment = new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
    );
    const client = new paypal.core.PayPalHttpClient(environment);

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
        intent: "CAPTURE", // Required for capturing funds
        purchase_units: [
            {
                custom_id: taskId, // Attach Task ID here
                description: `Payment for Task #${taskId}`,
                amount: {
                    currency_code: "GBP", // Ensure currency matches your region
                    value: (amount / 100).toFixed(2),
                },
            },
        ],
        application_context: {
            return_url: `https://efde-197-2-100-22.ngrok-free.app/api/webhooks/payment/success`,
            cancel_url: `https://efde-197-2-100-22.ngrok-free.app/api/webhooks/payment/cancel`,
          },
          
    });

    const order = await client.execute(request);
    return order.result.links.find((link) => link.rel === "approve").href; // Return approval URL
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
  
    const captureRequest = new paypal.orders.OrdersCaptureRequest(orderId);
    captureRequest.requestBody({});
    const captureResponse = await client.execute(captureRequest);
    return captureResponse.result;
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
