const paypal = require('@paypal/checkout-server-sdk');
const StandardItem = require('../models/StandardItem');
const Task = require('../models/Task');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY); // Pass the API key here

const VAT_RATE = 0.2; // VAT rate (20%)
const MINIMUM_PRICE = 45; // Minimum price including VAT (£37.5 + £7.5 VAT)

const NGROK_URL = 'https://api.londonwastemanagement.uk';
const CLIENT_URL = 'https://www.londonwastemanagement.com';

// PayPal environment configuration
const PAYPAL_MODE = process.env.PAYPAL_MODE || 'sandbox'; // 'sandbox' or 'live'

// Helper function to create PayPal environment based on PAYPAL_MODE
function createPayPalEnvironment() {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
        throw new Error("PayPal credentials (PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET) are required in environment variables");
    }
    
    if (PAYPAL_MODE === 'live') {
        console.log('🔴 Using PayPal LIVE environment');
        return new paypal.core.LiveEnvironment(clientId, clientSecret);
    } else {
        console.log('🟡 Using PayPal SANDBOX environment');
        return new paypal.core.SandboxEnvironment(clientId, clientSecret);
    }
}

async function calculateTotalPrice(taskId) {
    const task = await Task.findById(taskId).populate("items.standardItemId");
    if (!task) throw new Error("Task not found");
    console.log('taskDB:', task)
    let basePrice = 0;
    const breakdown = [];

    task.items.forEach((item) => {
        const quantity = item.quantity || 1;
        let price = 0;

        if (item.standardItemId) {
            // Use position-specific prices for standard items
            if (item.Objectsposition === 'InsideWithDismantling') {
                price = (item.standardItemId.insideWithDismantlingPrice) * quantity;
            } else if (item.Objectsposition === 'Inside') {
                price = (item.standardItemId.insidePrice) * quantity;
            } else {
                // Default to Outside position
                price = item.standardItemId.price * quantity;
            }
        } else {
            // Custom items use their own price
            price = item.price * quantity;
        }

        basePrice += price;

        const itemDescription = `${item.standardItemId ? "Standard Item - " + item.standardItemId.itemName : "Custom Item - " + item.object} (x${quantity})`;

        breakdown.push({
            itemDescription,
            price: price.toFixed(2),
            Objectsposition: item.Objectsposition || "Outside",
        });
    });

    const vat = basePrice * VAT_RATE;
    let finalPrice = basePrice + vat;

    // Apply minimum price if needed (check applyMinFee for Admin tasks)
    const enforceMinimumPrice = task.createdByType !== 'Admin' || task.applyMinFee === true;
    if (enforceMinimumPrice && finalPrice < MINIMUM_PRICE) {
        // Calculate the adjustment needed to reach £45 total
        const adjustment = MINIMUM_PRICE - finalPrice;

        // Add minimum price adjustment to the breakdown
        breakdown.push({
            description: "Minimum price adjustment",
            amount: adjustment.toFixed(2),
        });

        finalPrice = MINIMUM_PRICE;
        basePrice = MINIMUM_PRICE / (1 + VAT_RATE); // This will be £37.5
    }

    breakdown.push({ description: "VAT (20%)", amount: vat.toFixed(2) });
    breakdown.push({ description: "Final total price", amount: finalPrice.toFixed(2) });

    return {
        total: Math.round(finalPrice * 100), // Convert to pence for Stripe
        breakdown,
    };
}

const calculateTotalPriceUpdate = async (taskId) => {
    const task = await Task.findById(taskId).populate("items.standardItemId");
    if (!task) throw new Error("Task not found");

    let basePrice = 0;
    let allOutside = true;

    for (const item of task.items) {
        const quantity = Number(item.quantity) || 1;
        let price = 0;

        if (item.standardItemId) {
            const standardItem = await StandardItem.findById(item.standardItemId);
            if (standardItem) {
                // Use position-specific prices for standard items
                if (item.Objectsposition === 'InsideWithDismantling') {
                    price = (standardItem.insideWithDismantlingPrice) * quantity;
                } else if (item.Objectsposition === 'Inside') {
                    price = (standardItem.insidePrice) * quantity;
                } else {
                    // Default to Outside position
                    price = standardItem.price * quantity;
                }
            }
        } else if (item.price) {
            price = Number(item.price) * quantity;
        }

        basePrice += price;

        // Track if all items are outside for discount calculation
        if (item.Objectsposition !== "Outside") {
            allOutside = false;
        }
    }

    // // Apply Discount if all items are "Outside" and time is "AnyTime"
    // if (task.available === "AnyTime" && allOutside) {
    //     basePrice *= 0.9;
    // }

    const VAT_RATE = 0.2;
    const vat = basePrice * VAT_RATE;
    let finalPrice = basePrice + vat;

    // Apply minimum price if needed (check applyMinFee for Admin tasks)
    const enforceMinimumPrice = task.createdByType !== 'Admin' || task.applyMinFee === true;
    if (enforceMinimumPrice && finalPrice < MINIMUM_PRICE) {
        finalPrice = MINIMUM_PRICE;
    }

    return { total: Math.round(finalPrice * 100) / 100 };
};

const createStripePaymentLink = async (taskId, amountToPay, breakdown, paymentType, orderNumber) => {
    // VAT is already included in amountToPay, so we just convert to pence
    const amountInPence = Math.round(amountToPay * 100);
    console.log('amountInPence:', amountInPence);

    // Single line item for the payment amount
    const lineItems = [{
        price_data: {
            currency: "gbp",
            product_data: {
                name: paymentType === 'deposit' ? "Deposit Payment"
                    : paymentType === 'remaining' ? "Remaining Payment"
                        : paymentType === 'partial' ? "Partial Payment"
                            : "Payment",
                description: `Payment for Task #${orderNumber}`,
                images: [
                    'https://res.cloudinary.com/dehzhd6xs/image/upload/v1766479049/Group_1261156242_1_caq0t0.png',
                ],
            },
            unit_amount: amountInPence,
        },
        quantity: 1,
    }];

    // Include metadata for webhook processing
    const metadata = {
        taskId: String(taskId),
        paymentAmountType: paymentType || '',
    };

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: lineItems,
        mode: "payment",
        success_url: `${CLIENT_URL}/payment/success?taskId=${taskId}&paymentAmountType=${paymentType}&paymentType=stripe`,
        cancel_url: `${CLIENT_URL}/payment/failed?taskId=${taskId}&paymentAmountType=${paymentType}&paymentType=stripe`,
        metadata: metadata,
        custom_text: {
            submit: {
                message: "Thank you for choosing London Waste Management!",
            },
        },
    });

    return session.url;
};

const createPaypalPaymentLink = async (taskId, finalAmount, breakdown, paymentType = 'total') => {
    console.log("Generating PayPal link for items:", breakdown);
    let itemDetails = breakdown.filter(item => item.price != null && !isNaN(item.price)).map(item => ({
        name: item.itemDescription || "Item",
        description: `Position: ${item.Objectsposition || "Outside"} - Quantity: ${item.quantity || 1}`,
        unit_amount: {
            currency_code: "GBP",
            value: parseFloat(item.price).toFixed(2),
        },
        quantity: (item.quantity || 1).toString(),
    }));

    let itemTotal = itemDetails.reduce((sum, item) => sum + parseFloat(item.unit_amount.value) * parseInt(item.quantity), 0);
    let taxTotal = finalAmount - itemTotal;

    // If partial payment, send a single item for the partial amount
    if (finalAmount < itemTotal) {
        itemDetails = [{
            name: paymentType === 'deposit' ? 'Deposit Payment' : paymentType === 'remaining' ? 'Remaining Payment' : 'Partial Payment',
            description: `Partial payment for Task #${taskId}`,
            unit_amount: {
                currency_code: "GBP",
                value: finalAmount.toFixed(2),
            },
            quantity: "1",
        }];
        itemTotal = finalAmount;
        taxTotal = 0;
    }

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
            return_url: `${CLIENT_URL}/payment/success?taskId=${taskId}&paymentAmountType=${paymentType}&paymentType=paypal`,
            cancel_url: `${CLIENT_URL}/payment/failed?taskId=${taskId}&paymentAmountType=${paymentType}&paymentType=paypal`,
        }
    });

    try {
        const environment = createPayPalEnvironment();
        const client = new paypal.core.PayPalHttpClient(environment);
        const order = await client.execute(request);
        return order.result.links.find(link => link.rel === "approve").href;
    } catch (error) {
        console.error("Failed to create PayPal payment link:", error);
        if (error.statusCode === 401) {
            console.error("❌ PayPal authentication failed. Check your CLIENT_ID and CLIENT_SECRET match the PAYPAL_MODE (sandbox/live)");
        }
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

// async function createPayPalOrder(amount) {
//     const client = PayPalClient();
//     const request = new paypal.orders.OrdersCreateRequest();
//     request.requestBody({
//         intent: 'CAPTURE',
//         purchase_units: [{ amount: { currency_code: 'GBP', value: (amount / 100).toFixed(2) } }]
//     });
//     return client.execute(request);
// }
async function createPayPalOrder(amountInPence, taskId, fullBreakdown, task, paymentAmountType = 'full') {
    const client = PayPalClient();
    const request = new paypal.orders.OrdersCreateRequest();
    request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
            custom_id: String(taskId),
            amount: { currency_code: 'GBP', value: (amountInPence / 100).toFixed(2) }
        }],
        application_context: {
            brand_name: 'London Waste Management',
            landing_page: 'LOGIN',
            user_action: 'PAY_NOW',
            // ⬇️ Return to frontend with proper parameters
            return_url: `${CLIENT_URL}/payment/success?taskId=${taskId}&paymentAmountType=${paymentAmountType}&paymentType=paypal`,
            cancel_url: `${CLIENT_URL}/payment/failed?taskId=${taskId}&paymentAmountType=${paymentAmountType}&paymentType=paypal`,
        },
    });
    return client.execute(request);
}

// Fetch PayPal Order Details
const getPayPalOrderDetails = async (orderId) => {
    const environment = createPayPalEnvironment();
    const client = new paypal.core.PayPalHttpClient(environment);

    const request = new paypal.orders.OrdersGetRequest(orderId);
    const response = await client.execute(request);
    return response.result;
};

// Capture PayPal Payment
const capturePayPalPayment = async (orderId) => {
    const environment = createPayPalEnvironment();
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
    return new paypal.core.PayPalHttpClient(createPayPalEnvironment());
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

module.exports = { getPayPalOrderDetails, calculateTotalPrice, createStripePaymentIntent, capturePayPalPayment, createPayPalOrder, PayPalClient, createStripePaymentLink, createPaypalPaymentLink, calculateTotalPriceUpdate };