const paypal = require('@paypal/checkout-server-sdk');
const StandardItem = require('../models/StandardItem');
const Task = require('../models/Task');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY); // Pass the API key here

const VAT_RATE = 0.2; // VAT rate (20%)

async function calculateTotalPrice(taskId) {
    const task = await Task.findById(taskId).populate("items.standardItemId");
    if (!task) throw new Error("Task not found");

    let basePrice = 0;
    const breakdown = [];

    task.items.forEach((item) => {
        const quantity = item.quantity || 1;
        const price = item.standardItemId ? item.standardItemId.price * quantity : item.price * quantity;
        basePrice += price;

        const itemDescription = `${item.standardItemId ? "Standard Item - " + item.standardItemId.itemName : "Custom Item - " + item.object} (x${quantity})`;

        breakdown.push({
            itemDescription,
            price: price.toFixed(2),
            Objectsposition: item.Objectsposition || "Outside",
        });

        // Add additional fees based on item position
        if (["InsideWithDismantling", "Inside"].includes(item.Objectsposition)) {
            const additionalFee = item.Objectsposition === "InsideWithDismantling" ? 18 : 6;
            basePrice += additionalFee;

            breakdown.push({
                description: `${item.Objectsposition} fee for '${item.object || "item"}'`,
                amount: additionalFee.toFixed(2),
            });
        }
    });

    const vat = basePrice * VAT_RATE;
    const finalPrice = basePrice + vat;

    breakdown.push({ description: "VAT (20%)", amount: vat.toFixed(2) });
    breakdown.push({ description: "Final total price", amount: finalPrice.toFixed(2) });

    return {
        total: Math.round(finalPrice * 100), // Convert to pence for Stripe
        breakdown,
    };
}

const createStripePaymentLink = async (taskId, finalAmount, breakdown) => {
    const description = breakdown
        .map((item) => `${item.itemDescription || item.description}: £${item.price || item.amount}`)
        .join(", ");

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
            {
                price_data: {
                    currency: "gbp",
                    product_data: {
                        name: `Payment for Task #${taskId}`,
                        description,
                    },
                    unit_amount: finalAmount, // Final amount in pence
                },
                quantity: 1,
            },
        ],
        mode: "payment", // Payment mode
        success_url: `https://7026-197-0-13-187.ngrok-free.app/api/webhooks/payment/success`,
        cancel_url: `https://7026-197-0-13-187.ngrok-free.app/api/webhooks/payment/cancel`,
        metadata: {
            taskId,
            breakdown: JSON.stringify(breakdown), // Store breakdown as metadata
        },
    });

    return session.url;
};

const createPaypalPaymentLink = async (taskId, finalAmount, breakdown) => {
    console.log("Generating PayPal link for items:", breakdown);
    const itemDetails = breakdown.filter(item => item.price != null && !isNaN(item.price)).map(item => ({
      name: item.itemDescription || "Item",
      description: `Position: ${item.Objectsposition || "Outside"} - Quantity: ${item.quantity || 1}`,
      unit_amount: {
        currency_code: "GBP",
        value: parseFloat(item.price).toFixed(2),
      },
      quantity: (item.quantity || 1).toString(),
    }));
  
    const itemTotal = itemDetails.reduce((sum, item) => sum + parseFloat(item.unit_amount.value) * parseInt(item.quantity), 0);
    const taxTotal = finalAmount - itemTotal;
  
    if (taxTotal < 0) {
      console.error("Calculated tax total is invalid.", { finalAmount, itemTotal, taxTotal });
      throw new Error("Calculated tax total is invalid.");
    }
  
    const request = new paypal.orders.OrdersCreateRequest();
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [{
        custom_id: taskId,
        description: `Payment for Task #${taskId}`,
        amount: {
          currency_code: "GBP",
          value: finalAmount.toFixed(2),
          breakdown: {
            item_total: { currency_code: "GBP", value: itemTotal.toFixed(2) },
            tax_total: { currency_code: "GBP", value: taxTotal.toFixed(2) }
          }
        },
        items: itemDetails
      }],
      application_context: {
        return_url: `https://7026-197-0-13-187.ngrok-free.app/api/webhooks/payment/success`,
        cancel_url: `https://7026-197-0-13-187.ngrok-free.app/api/webhooks/payment/cancel`,
      }
    });
  
    try {
      const environment = new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);
      const client = new paypal.core.PayPalHttpClient(environment);
      const order = await client.execute(request);
      return order.result.links.find(link => link.rel === "approve").href;
    } catch (error) {
      console.error("Failed to create PayPal payment link:", error);
      throw error;
    }
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