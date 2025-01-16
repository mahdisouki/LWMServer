const paypal = require('@paypal/checkout-server-sdk');
const StandardItem = require('../models/StandardItem');
const Task = require('../models/Task');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY); // Pass the API key here

const VAT_RATE = 0.2; // 20% VAT rate

const calculateTotalPrice = async (taskId) => {
    const task = await Task.findById(taskId).populate("items.standardItemId");
    if (!task) throw new Error("Task not found");

    let basePrice = 0; // Somme des prix des items sans frais supplémentaires
    let additionalFees = 0; // Frais supplémentaires pour les positions "Inside" ou "InsideWithDismantling"
    let discount = 0; // Réduction de 10% si applicable
    const breakdown = []; // Pour stocker les détails de chaque item

    for (const item of task.items) {
        const quantity = item.quantity || 1;
        let itemPrice = 0;

        if (item.standardItemId) {
            const standardItem = item.standardItemId;
            itemPrice = standardItem.price * quantity;

            breakdown.push({
                itemDescription: `Standard Item - ${standardItem.itemName} (x${quantity})`,
                price: itemPrice.toFixed(2),
                Objectsposition: item.Objectsposition || "Outside",
            });

            // Ajouter les frais selon la position
            if (item.Objectsposition === "InsideWithDismantling") {
                additionalFees += 18;
                breakdown.push({ description: `Dismantling fee for '${standardItem.itemName}'`, amount: 18 });
            } else if (item.Objectsposition === "Inside") {
                additionalFees += 6;
                breakdown.push({ description: `Inside fee for '${standardItem.itemName}'`, amount: 6 });
            }

        } else if (item.object && item.price) {
            itemPrice = item.price * quantity;

            breakdown.push({
                itemDescription: `Custom Item - ${item.object} (x${quantity})`,
                price: itemPrice.toFixed(2),
                Objectsposition: item.Objectsposition || "Outside",
            });

            // Ajouter les frais selon la position pour les items personnalisés
            if (item.Objectsposition === "InsideWithDismantling") {
                additionalFees += 18;
                breakdown.push({ description: `Dismantling fee for '${item.object}'`, amount: 18 });
            } else if (item.Objectsposition === "Inside") {
                additionalFees += 6;
                breakdown.push({ description: `Inside fee for '${item.object}'`, amount: 6 });
            }
        }

        basePrice += itemPrice; // Ajouter le prix de l'item au prix de base
    }

    // Appliquer la réduction de 10% si applicable
    if (task.available === "AnyTime" && task.items.every((i) => i.Objectsposition === "Outside")) {
        discount = basePrice * 0.1;
        breakdown.push({ description: "10% discount for 'Outside' and 'AnyTime'", amount: -discount.toFixed(2) });
        basePrice -= discount; // Réduire le prix de base
    }

    const totalBeforeVAT = basePrice + additionalFees; // Total avant TVA

    // Si le total est inférieur à £30, le fixer à £30
    let adjustedTotal = totalBeforeVAT;
    if (totalBeforeVAT < 30) {
        const adjustment = 30 - totalBeforeVAT;
        adjustedTotal = 30;
        breakdown.push({ description: "Minimum fee adjustment to £30", amount: adjustment.toFixed(2) });
    }

    const vat = adjustedTotal * VAT_RATE; // Calcul de la TVA
    const finalPrice = adjustedTotal + vat; // Prix final avec TVA

    breakdown.push({ description: "VAT (20%)", amount: vat.toFixed(2) });
    breakdown.push({ description: "Final total price", amount: finalPrice.toFixed(2) });

    return {
        total: Math.round(finalPrice * 100), // En pence
        breakdown,
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

const createStripePaymentLink = async (taskId, finalAmount, breakdown = []) => {
    const description = breakdown.length
        ? breakdown
              .map(item => `${item.itemDescription || item.description }: £${item.price || item.amount }`)
              .join(', ')
        : `Total price: £${(finalAmount / 100).toFixed(2)}`; // En pence

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: 'gbp',
                    product_data: {
                        name: `Payment for Task #${taskId}`,
                        description,
                    },
                    unit_amount: finalAmount, // Le montant final après calcul
                },
                quantity: 1,
            },
        ],
        mode: 'payment',
        metadata: {
            taskId,
            breakdown: JSON.stringify(breakdown || []), // Ajout du breakdown avec la TVA
        },
        success_url: 'https://dc2f-102-156-43-63.ngrok-free.app/api/webhooks/payment/success',
        cancel_url: 'https://dc2f-102-156-43-63.ngrok-free.app/api/webhooks/payment/cancel',
    });

    return session.url;
};

const createPaypalPaymentLink = async (taskId, finalAmount, breakdown = [], taskDetails) => {
    const environment = new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
    );
    const client = new paypal.core.PayPalHttpClient(environment);

    // Si breakdown n'est pas un tableau, le convertir en tableau vide
    if (!Array.isArray(breakdown)) {
        console.error("Error: Breakdown is not an array:", breakdown);
        breakdown = []; // Défaut à un tableau vide si ce n'est pas un tableau
    }

    const description = breakdown.length
        ? breakdown
              .map(item => `${item.itemDescription || item.description}: £${item.price || item.amount}`)
              .join(', ')
        : `Total price: £${(finalAmount / 100).toFixed(2)}`;

    const itemsDetails = breakdown.map(item => ({
        name: item.itemDescription || "Item",
        description: `Position: ${item.Objectsposition || "Outside"} - Quantity: ${item.quantity || 1}`,
        unit_amount: {
            currency_code: "GBP",
            value: item.price && !isNaN(item.price) ? (item.price / 100).toFixed(2) : "0.00",
        },
        quantity: (item.quantity || 1).toString(),
    }));

    const request = new paypal.orders.OrdersCreateRequest();
    request.requestBody({
        intent: "CAPTURE",
        purchase_units: [
            {
                custom_id: taskId,
                description: `Payment for Task #${taskId}`,
                amount: {
                    currency_code: "GBP",
                    value: (finalAmount / 100).toFixed(2),
                    breakdown: {
                        item_total: {
                            currency_code: "GBP",
                            value: ((finalAmount - (finalAmount * 0.2)) / 100).toFixed(2),
                        },
                        tax_total: {
                            currency_code: "GBP",
                            value: ((finalAmount * 0.2) / 100).toFixed(2),
                        },
                    },
                },
                items: itemsDetails,
            },
        ],
        application_context: {
            return_url: 'https://dc2f-102-156-43-63.ngrok-free.app/api/webhooks/payment/success',
            cancel_url: 'https://dc2f-102-156-43-63.ngrok-free.app/api/webhooks/payment/cancel',
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