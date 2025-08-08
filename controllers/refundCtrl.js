// const Task = require('../models/Task');
// const PaymentHistory = require('../models/PaymentHistory');
// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
// const paypal = require('@paypal/checkout-server-sdk');
// const { sendRefundEmail } = require('../services/emailsService');

// // PayPal Client setup
// function PayPalClient() {
//     return new paypal.core.PayPalHttpClient(new paypal.core.SandboxEnvironment(
//         process.env.PAYPAL_CLIENT_ID,
//         process.env.PAYPAL_SECRET
//     ));
// }

// async function verifyStripeRefund(refundId) {
//     const refund = await stripe.refunds.retrieve(refundId);
//     return refund.status === 'succeeded';
// }

// async function verifyPayPalRefund(refundId) {
//     const request = new paypal.payments.RefundsGetRequest(refundId);
//     const response = await PayPalClient().execute(request);
//     return response.result && response.result.status === 'COMPLETED';
// }

// exports.processRefund = async (req, res) => {
//     const { taskId, refundAmount } = req.body;

//     console.log("Refund request:", taskId, refundAmount);
//     try {
//         const task = await Task.findById(taskId);
//         if (!task) return res.status(404).json({ message: "Task not found" });

//         const paymentHistory = await PaymentHistory.findOne({ taskId });
//         if (!paymentHistory) return res.status(404).json({ message: "Payment history not found" });
//         console.log(paymentHistory)
//         if (!refundAmount || refundAmount <= 0) {
//             return res.status(400).json({ message: "Invalid refund amount" });
//         }

//         if (refundAmount > paymentHistory.amount) {
//             return res.status(400).json({ message: "Refund amount exceeds original payment amount" });
//         }

//         let refundVerified = false;
//         console.log("Payment History:", paymentHistory.paymentType);
//         if (paymentHistory.paymentType === 'Stripe') {
//             const refund = await stripe.refunds.create({
//                 payment_intent: paymentHistory.transactionId,
//                 amount: Math.round(refundAmount * 100)
//             });
//             refundVerified = await verifyStripeRefund(refund.id);
//         } else if (paymentHistory.paymentType === 'Paypal') {
//             try {
//                 const request = new paypal.payments.CapturesRefundRequest(paymentHistory.transactionId);
//                 request.requestBody({
//                     amount: {
//                         value: refundAmount.toFixed(2),
//                         currency_code: 'GBP'
//                     }
//                 });
//                 const refund = await PayPalClient().execute(request);
//                 refundVerified = await verifyPayPalRefund(refund.result.id);
//             } catch (error) {
//                 if (error.statusCode === 422 && error.message.includes("CAPTURE_FULLY_REFUNDED")) {
//                     refundVerified = true;
//                 } else {
//                     throw error;
//                 }
//             }
//         }

//         if (refundVerified) {
//             const task = await Task.findById(paymentHistory.taskId);
//             const totalPaid = paymentHistory.amount;
//             const remainingAmount = totalPaid - refundAmount;
//             console.log("totalPaid", totalPaid, "remainingAmount", remainingAmount, "refundAmount", refundAmount)
//             if (remainingAmount <= 0) {
//                 task.paymentStatus = 'refunded';
//             } else {
//                 task.paymentStatus = 'partial_Refunded';
//             }

//             await task.save();
//             // Send refund email with invoice
//             await sendRefundEmail({ task, paymentHistory, refundAmount });
//             return res.status(200).json({
//                 message: `Refund of £${refundAmount.toFixed(2)} processed successfully`,
//                 remainingAmount
//             });
//         } else {
//             return res.status(400).json({ message: "Refund verification failed" });
//         }
//     } catch (error) {
//         console.error("Error processing refund:", error);
//         res.status(500).json({ message: "Error processing refund", error: error.message });
//     }
// };
const Task = require('../models/Task');
const PaymentHistory = require('../models/PaymentHistory');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
const { sendRefundEmail } = require('../services/emailsService');

// PayPal Client setup
function PayPalClient() {
    return new paypal.core.PayPalHttpClient(new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_SECRET
    ));
}

async function verifyStripeRefund(refundId) {
    const refund = await stripe.refunds.retrieve(refundId);
    return refund.status === 'succeeded';
}

async function verifyPayPalRefund(refundId) {
    const request = new paypal.payments.RefundsGetRequest(refundId);
    const response = await PayPalClient().execute(request);
    return response.result && response.result.status === 'COMPLETED';
}

exports.processRefund = async (req, res) => {
    const { taskId, refundAmount } = req.body;

    // NEW: vars to capture refund info for logging
    let createdRefundId = null;          // NEW
    let createdRefundStatus = null;      // NEW
    let rawRefundPayload = null;         // NEW

    console.log("Refund request:", taskId, refundAmount);
    try {
        const task = await Task.findById(taskId);
        if (!task) return res.status(404).json({ message: "Task not found" });

        const paymentHistory = await PaymentHistory.findOne({ taskId });
        if (!paymentHistory) return res.status(404).json({ message: "Payment history not found" });
        console.log(paymentHistory)
        if (!refundAmount || refundAmount <= 0) {
            return res.status(400).json({ message: "Invalid refund amount" });
        }

        if (refundAmount > paymentHistory.amount) {
            return res.status(400).json({ message: "Refund amount exceeds original payment amount" });
        }

        let refundVerified = false;
        console.log("Payment History:", paymentHistory.paymentType);
        if (paymentHistory.paymentType === 'Stripe') {
            const refund = await stripe.refunds.create({
                payment_intent: paymentHistory.transactionId,
                amount: Math.round(refundAmount * 100)
            });
            // NEW: capture refund details
            createdRefundId = refund.id;                 // NEW
            createdRefundStatus = refund.status;         // NEW
            rawRefundPayload = refund;                   // NEW

            refundVerified = await verifyStripeRefund(refund.id);

        } else if (paymentHistory.paymentType === 'Paypal') {
            try {
                const request = new paypal.payments.CapturesRefundRequest(paymentHistory.transactionId);
                request.requestBody({
                    amount: {
                        value: refundAmount.toFixed(2),
                        currency_code: 'GBP'
                    }
                });
                const refund = await PayPalClient().execute(request);

                // NEW: capture refund details
                createdRefundId = refund?.result?.id || null;       // NEW
                createdRefundStatus = refund?.result?.status || null;// NEW
                rawRefundPayload = refund?.result || null;           // NEW

                refundVerified = await verifyPayPalRefund(refund.result.id);
            } catch (error) {
                if (error.statusCode === 422 && error.message.includes("CAPTURE_FULLY_REFUNDED")) {
                    // NEW: mark as completed even if already fully refunded
                    createdRefundId = createdRefundId || 'already_fully_refunded'; // NEW
                    createdRefundStatus = createdRefundStatus || 'COMPLETED';      // NEW

                    refundVerified = true;
                } else {
                    throw error;
                }
            }
        }

        if (refundVerified) {
            // NEW: persist refund record onto PaymentHistory (no schema change needed)
            try {
                const gateway = String(paymentHistory.paymentType || '').toLowerCase(); // NEW
                const refundRecord = {                                                  // NEW
                    refundId: createdRefundId,
                    gateway,
                    amountGBP: Number(refundAmount), // you store/display in GBP here
                    currency: 'GBP',
                    status: createdRefundStatus,
                    createdAt: new Date(),
                    metadata: rawRefundPayload ? { raw: rawRefundPayload } : undefined,
                };
                await PaymentHistory.updateOne(                                       // NEW
                    { _id: paymentHistory._id },
                    {
                        $push: { refunds: refundRecord },
                        $inc: { refundedTotalGBP: Number(refundAmount) }
                    },
                    { strict: false } // allow fields even if schema doesn't declare them
                );
            } catch (logErr) {
                console.error('Warning: refund logged failed (non-fatal):', logErr);   // NEW
            }

            const task = await Task.findById(paymentHistory.taskId);
            const totalPaid = paymentHistory.amount;
            const remainingAmount = totalPaid - refundAmount;
            console.log("totalPaid", totalPaid, "remainingAmount", remainingAmount, "refundAmount", refundAmount)
            if (remainingAmount <= 0) {
                task.paymentStatus = 'refunded';
            } else {
                task.paymentStatus = 'partial_Refunded';
            }

            await task.save();
            // Send refund email with invoice
            await sendRefundEmail({ task, paymentHistory, refundAmount });
            return res.status(200).json({
                message: `Refund of £${refundAmount.toFixed(2)} processed successfully`,
                remainingAmount
            });
        } else {
            return res.status(400).json({ message: "Refund verification failed" });
        }
    } catch (error) {
        console.error("Error processing refund:", error);
        res.status(500).json({ message: "Error processing refund", error: error.message });
    }
};
