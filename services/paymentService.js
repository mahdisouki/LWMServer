const paypal = require('@paypal/checkout-server-sdk');
const StandardItem = require('../models/StandardItem');
const Task = require('../models/Task');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY); // Pass the API key here

const VAT_RATE = 0.2; // VAT rate (20%)
const MINIMUM_PRICE = 36; // Minimum price including VAT

const NGROK_URL = 'https://londonwastemanagement.uk';

async function calculateTotalPrice(taskId) {
    const task = await Task.findById(taskId).populate("items.standardItemId");
    if (!task) throw new Error("Task not found");
    console.log('taskDB:', task)
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
    let finalPrice = basePrice + vat;

    // Apply minimum price of £36 (including VAT)
    if (finalPrice < MINIMUM_PRICE) {
        if (breakdown.length > 0) {
            const firstItem = breakdown[0];
            const currentPrice = parseFloat(firstItem.price || firstItem.amount);
            const adjustment = (MINIMUM_PRICE - finalPrice) / (1 + VAT_RATE);
            const newPrice = (currentPrice + adjustment).toFixed(2);
            
            if (firstItem.itemDescription) {
                firstItem.price = newPrice;
            } else {
                firstItem.amount = newPrice;
            }
        }
        finalPrice = MINIMUM_PRICE;
        basePrice = MINIMUM_PRICE / (1 + VAT_RATE);
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
                price = standardItem.price * quantity;
            }
        } else if (item.price) {
            price = Number(item.price) * quantity;
        }

        basePrice += price;

        // Add extra fee
        if (item.Objectsposition === "InsideWithDismantling") {
            basePrice += 18;
            allOutside = false;
        } else if (item.Objectsposition === "Inside") {
            basePrice += 6;
            allOutside = false;
        } else if (item.Objectsposition !== "Outside") {
            allOutside = false;
        }
    }

    // Apply Discount if all items are "Outside" and time is "AnyTime"
    if (task.available === "AnyTime" && allOutside) {
        basePrice *= 0.9;
    }

    const VAT_RATE = 0.2;
    const vat = basePrice * VAT_RATE;
    let finalPrice = basePrice + vat;

    // Apply minimum price of £36 (including VAT)
    if (finalPrice < MINIMUM_PRICE) {
        finalPrice = MINIMUM_PRICE;
    }

    return { total: Math.round(finalPrice * 100) / 100 };
};

const createStripePaymentLink = async (taskId, finalAmount, breakdown, paymentType) => {
    // Create line items from the breakdown
    const lineItems = breakdown.map(item => {
        // Skip VAT and total entries as they'll be handled separately
        if (item.description === "VAT (20%)" || item.description === "Final total price") {
            return null;
        }

        // Convert price to pence
        const amount = Math.round(parseFloat(item.price || item.amount) * 100);
        
        return {
            price_data: {
                currency: "gbp",
                product_data: {
                    name: item.itemDescription || item.description,
                    description: item.Objectsposition ? `Position: ${item.Objectsposition}` : undefined,
                    images: ["https://res.cloudinary.com/dfxeaeebv/image/upload/v1742959873/slpany1oqx09lxj72nmd.png"],
                },
                unit_amount: amount,
            },
            quantity: 1,
        };
    }).filter(item => item !== null);

    // Add VAT as a separate line item
    const vatItem = breakdown.find(item => item.description === "VAT (20%)");
    if (vatItem) {
        lineItems.push({
            price_data: {
                currency: "gbp",
                product_data: {
                    name: "VAT (20%)",
                    description: "Value Added Tax",
                },
                unit_amount: Math.round(parseFloat(vatItem.amount) * 100),
            },
            quantity: 1,
        });
    }

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card", "paypal"],
        line_items: lineItems,
        mode: "payment",
        success_url: `${NGROK_URL}/api/webhooks/payment/success`,
        cancel_url: `${NGROK_URL}/api/webhooks/payment/cancel`,
        metadata: {
            taskId,
            breakdown: JSON.stringify(breakdown),
            paymentType: paymentType,
            totalItems: breakdown.length.toString(),
            orderDate: new Date().toISOString(),
        },
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
            return_url: `${NGROK_URL}/api/webhooks/payment/success`,
            cancel_url: `${NGROK_URL}/api/webhooks/payment/cancel`,
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
        payment_method_types: ['card', 'paypal'],
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

module.exports = { getPayPalOrderDetails, calculateTotalPrice, createStripePaymentIntent, capturePayPalPayment, createPayPalOrder, PayPalClient, createStripePaymentLink, createPaypalPaymentLink, calculateTotalPriceUpdate };