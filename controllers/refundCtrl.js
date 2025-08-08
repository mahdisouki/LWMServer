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

/** -------- PayPal client (sandbox) -------- */
function PayPalClient() {
    // use the right env var name
    return new paypal.core.PayPalHttpClient(
        new paypal.core.SandboxEnvironment(
            process.env.PAYPAL_CLIENT_ID,
            process.env.PAYPAL_CLIENT_SECRET // <-- fixed
        )
    );
}

/** -------- Helpers -------- */
async function verifyStripeRefund(refundId) {
    const refund = await stripe.refunds.retrieve(refundId);
    return refund.status === 'succeeded';
}

async function verifyPayPalRefund(refundId) {
    const req = new paypal.payments.RefundsGetRequest(refundId);
    const res = await PayPalClient().execute(req);
    return res.result && res.result.status === 'COMPLETED';
}

/** Normalize whatever was stored to GBP for fair comparisons */
function normalizeStoredAmountToGBP(paymentType, storedAmount) {
    const n = Number(storedAmount);
    if (!Number.isFinite(n)) return 0;

    const gw = String(paymentType || '').toLowerCase();

    if (gw === 'paypal') {
        // You now store GBP for PayPal. If some legacy rows were pence,
        // convert only if it clearly looks like pence (big integer).
        return (Number.isInteger(n) && n >= 1000) ? n / 100 : n;
    }

    if (gw === 'stripe') {
        // Stripe is usually pence. Convert if it looks like pence.
        return (Number.isInteger(n) && n >= 100) ? n / 100 : n;
    }

    return n;
}

exports.processRefund = async (req, res) => {
    const taskId = String(req.body.taskId || '').trim();
    const refundAmountGBP = Number(req.body.refundAmount);

    console.log('Refund request:', taskId, refundAmountGBP);

    try {
        const task = await Task.findById(taskId);
        if (!task) return res.status(404).json({ message: 'Task not found' });

        const paymentHistory = await PaymentHistory.findOne({ taskId }).lean();
        if (!paymentHistory) {
            return res.status(404).json({ message: 'Payment history not found' });
        }

        if (!refundAmountGBP || refundAmountGBP <= 0) {
            return res.status(400).json({ message: 'Invalid refund amount' });
        }

        const gateway = String(paymentHistory.paymentType || '').toLowerCase();
        const originalPaidGBP = normalizeStoredAmountToGBP(
            paymentHistory.paymentType,
            paymentHistory.amount
        );

        console.log({
            gateway,
            rawAmount: paymentHistory.amount,
            originalPaidGBP,
            refundAmountGBP,
            txId: paymentHistory.transactionId
        });

        if (refundAmountGBP > originalPaidGBP) {
            return res
                .status(400)
                .json({ message: 'Refund amount exceeds original payment amount' });
        }

        let refundVerified = false;

        if (gateway === 'stripe') {
            const refund = await stripe.refunds.create({
                payment_intent: paymentHistory.transactionId,
                amount: Math.round(refundAmountGBP * 100) // pence
            });
            refundVerified = await verifyStripeRefund(refund.id);

        } else if (gateway === 'paypal') {
            // Refund the CAPTURE id we stored
            const reqRefund = new paypal.payments.CapturesRefundRequest(
                paymentHistory.transactionId
            );
            const body = {};

            // Only include amount for partial refunds
            if (refundAmountGBP < originalPaidGBP) {
                body.amount = {
                    value: refundAmountGBP.toFixed(2),
                    currency_code: 'GBP'
                };
            }
            reqRefund.requestBody(body);

            try {
                const refundRes = await PayPalClient().execute(reqRefund);
                refundVerified = await verifyPayPalRefund(refundRes.result.id);
            } catch (error) {
                // If already fully refunded, PayPal returns 422 CAPTURE_FULLY_REFUNDED
                if (
                    error.statusCode === 422 &&
                    String(error.message || '').includes('CAPTURE_FULLY_REFUNDED')
                ) {
                    refundVerified = true;
                } else {
                    throw error;
                }
            }
        } else {
            return res
                .status(400)
                .json({ message: `Unsupported payment type: ${paymentHistory.paymentType}` });
        }

        if (!refundVerified) {
            return res.status(400).json({ message: 'Refund verification failed' });
        }

        // Update task status
        const remainingAmount = +(originalPaidGBP - refundAmountGBP).toFixed(2);
        task.paymentStatus = remainingAmount <= 0 ? 'refunded' : 'partial_Refunded';
        await task.save();

        await sendRefundEmail({
            task,
            paymentHistory,
            refundAmount: refundAmountGBP
        });

        return res.status(200).json({
            message: `Refund of £${refundAmountGBP.toFixed(2)} processed successfully`,
            remainingAmount
        });
    } catch (error) {
        console.error('Error processing refund:', error);
        res
            .status(500)
            .json({ message: 'Error processing refund', error: error.message });
    }
};
