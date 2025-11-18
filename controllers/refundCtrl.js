const Task = require('../models/Task');
const PaymentHistory = require('../models/PaymentHistory');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
const { sendRefundEmail } = require('../services/emailsService');

// PayPal Client setup
function PayPalClient() {
    return new paypal.core.PayPalHttpClient(new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
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

// Helper function to process a single refund for a payment history
async function processSingleRefund(paymentHistory, amountToRefund) {
    const gateway = String(paymentHistory.paymentType || '').toLowerCase();
    let refundId = null;
    let refundStatus = null;
    let rawPayload = null;
    let verified = false;

    if (paymentHistory.paymentType === 'Stripe') {
        const refund = await stripe.refunds.create({
            payment_intent: paymentHistory.transactionId,
            amount: Math.round(amountToRefund * 100)
        });
        refundId = refund.id;
        refundStatus = refund.status;
        rawPayload = refund;
        verified = await verifyStripeRefund(refund.id);

    } else if (paymentHistory.paymentType.toLowerCase() === 'paypal') {
        try {
            const request = new paypal.payments.CapturesRefundRequest(paymentHistory.transactionId);
            request.requestBody({
                amount: {
                    value: amountToRefund.toFixed(2),
                    currency_code: 'GBP'
                }
            });
            const refund = await PayPalClient().execute(request);
            refundId = refund?.result?.id || null;
            refundStatus = refund?.result?.status || null;
            rawPayload = refund?.result || null;
            verified = await verifyPayPalRefund(refund.result.id);

        } catch (error) {
            console.error("PayPal Refund Error:", JSON.stringify(error, null, 2));
            if (error.statusCode === 422 && error.message.includes("CAPTURE_FULLY_REFUNDED")) {
                refundId = refundId || 'already_fully_refunded';
                refundStatus = refundStatus || 'COMPLETED';
                verified = true;
            } else {
                throw error;
            }
        }
    }

    return { verified, refundId, refundStatus, rawPayload, gateway };
}

exports.processRefund = async (req, res) => {
    const { taskId, refundAmount } = req.body;

    console.log("Refund request:", taskId, refundAmount);
    try {
        const task = await Task.findById(taskId);
        if (!task) return res.status(404).json({ message: "Task not found" });

        // Find ALL payment histories for this task (deposit + remaining)
        const paymentHistories = await PaymentHistory.find({ taskId });
        if (!paymentHistories || paymentHistories.length === 0) {
            return res.status(404).json({ message: "Payment history not found" });
        }

        // Calculate total paid across all payment histories
        const totalPaidAcrossAll = paymentHistories.reduce((sum, ph) => {
            return sum + (ph.amount || 0);
        }, 0);

        // Calculate total already refunded across all payment histories
        const totalRefundedSoFar = paymentHistories.reduce((sum, ph) => {
            return sum + (ph.refundedTotalGBP || 0);
        }, 0);

        // Calculate available amount to refund
        const availableToRefund = totalPaidAcrossAll - totalRefundedSoFar;

        if (!refundAmount || refundAmount <= 0) {
            return res.status(400).json({ message: "Invalid refund amount" });
        }

        // Validate against total paid across all payment histories
        if (refundAmount > availableToRefund) {
            return res.status(400).json({
                message: `Refund amount exceeds available amount. Total paid: £${totalPaidAcrossAll.toFixed(2)}, Already refunded: £${totalRefundedSoFar.toFixed(2)}, Available: £${availableToRefund.toFixed(2)}`
            });
        }

        // Step 1: Try to find a single payment history with enough balance (simple case)
        let singlePaymentHistory = null;
        let maxAvailableInAny = 0;

        for (const ph of paymentHistories) {
            const alreadyRefunded = ph.refundedTotalGBP || 0;
            const availableInThis = ph.amount - alreadyRefunded;

            if (availableInThis > maxAvailableInAny) {
                maxAvailableInAny = availableInThis;
            }

            if (availableInThis >= refundAmount) {
                singlePaymentHistory = ph;
                break;
            }
        }

        // Step 2: If single payment history found, process simple refund
        if (singlePaymentHistory) {
            const result = await processSingleRefund(singlePaymentHistory, refundAmount);

            if (!result.verified) {
                return res.status(400).json({ message: "Refund verification failed" });
            }

            // Persist refund record
            try {
                const refundRecord = {
                    refundId: result.refundId,
                    gateway: result.gateway,
                    amountGBP: Number(refundAmount),
                    currency: 'GBP',
                    status: result.refundStatus,
                    createdAt: new Date(),
                    metadata: result.rawPayload ? { raw: result.rawPayload } : undefined,
                };
                await PaymentHistory.updateOne(
                    { _id: singlePaymentHistory._id },
                    {
                        $push: { refunds: refundRecord },
                        $inc: { refundedTotalGBP: Number(refundAmount) }
                    }
                );
            } catch (logErr) {
                console.error('Warning: refund logged failed (non-fatal):', logErr);
            }

            // Update task status
            const updatedHistories = await PaymentHistory.find({ taskId });
            const newTotalRefunded = updatedHistories.reduce((sum, ph) => {
                return sum + (ph.refundedTotalGBP || 0);
            }, 0);
            const remainingAmount = totalPaidAcrossAll - newTotalRefunded;

            if (remainingAmount <= 0) {
                task.paymentStatus = 'refunded';
            } else {
                task.paymentStatus = 'partial_Refunded';
            }
            await task.save();

            await sendRefundEmail({ task, paymentHistory: singlePaymentHistory, refundAmount });

            return res.status(200).json({
                message: `Refund of £${refundAmount.toFixed(2)} processed successfully`,
                remainingAmount,
                totalRefunded: newTotalRefunded,
                totalPaid: totalPaidAcrossAll
            });
        }

        // Step 3: No single payment history has enough - check if we can split across multiple
        // Get payment histories with available balance, grouped by gateway
        const availableHistories = paymentHistories
            .map(ph => {
                const alreadyRefunded = ph.refundedTotalGBP || 0;
                const available = ph.amount - alreadyRefunded;
                return { paymentHistory: ph, available, gateway: ph.paymentType };
            })
            .filter(item => item.available > 0)
            .sort((a, b) => b.available - a.available); // Sort by available amount descending

        if (availableHistories.length === 0) {
            return res.status(400).json({
                message: "No available balance to refund from any payment history. All payments have been fully refunded."
            });
        }

        // Check gateways - we can split across same OR different gateways
        const uniqueGateways = [...new Set(availableHistories.map(h => h.gateway))];
        const isCrossPlatform = uniqueGateways.length > 1;

        if (isCrossPlatform) {
            console.log(`Splitting refund of £${refundAmount.toFixed(2)} across ${availableHistories.length} payment histories with different gateways (${uniqueGateways.join(', ')})`);
        } else {
            const commonGateway = uniqueGateways[0];
            console.log(`Splitting refund of £${refundAmount.toFixed(2)} across ${availableHistories.length} payment histories (${commonGateway})`);
        }

        // Split refund amount across available payment histories
        let remainingToRefund = refundAmount;
        const refundResults = [];

        for (const item of availableHistories) {
            if (remainingToRefund <= 0) break;

            const amountToRefundFromThis = Math.min(remainingToRefund, item.available);

            console.log(`Processing refund: £${amountToRefundFromThis.toFixed(2)} from transaction ${item.paymentHistory.transactionId}`);

            try {
                const result = await processSingleRefund(item.paymentHistory, amountToRefundFromThis);

                if (!result.verified) {
                    throw new Error(`Refund verification failed for transaction ${item.paymentHistory.transactionId}`);
                }

                // Persist refund record
                const refundRecord = {
                    refundId: result.refundId,
                    gateway: result.gateway,
                    amountGBP: Number(amountToRefundFromThis),
                    currency: 'GBP',
                    status: result.refundStatus,
                    createdAt: new Date(),
                    metadata: result.rawPayload ? { raw: result.rawPayload } : undefined,
                };

                await PaymentHistory.updateOne(
                    { _id: item.paymentHistory._id },
                    {
                        $push: { refunds: refundRecord },
                        $inc: { refundedTotalGBP: Number(amountToRefundFromThis) }
                    }
                );

                refundResults.push({
                    paymentHistoryId: item.paymentHistory._id,
                    transactionId: item.paymentHistory.transactionId,
                    gateway: result.gateway,
                    amount: amountToRefundFromThis,
                    refundId: result.refundId
                });

                remainingToRefund -= amountToRefundFromThis;

            } catch (error) {
                console.error(`Error processing refund for transaction ${item.paymentHistory.transactionId}:`, error);
                // If one refund fails, we should rollback or at least report the issue
                // For now, we'll throw to stop the process
                throw new Error(`Failed to process refund: ${error.message}. Some refunds may have been processed.`);
            }
        }

        // Verify all refunds were processed
        if (remainingToRefund > 0) {
            return res.status(400).json({
                message: `Could not fully process refund. Processed: £${(refundAmount - remainingToRefund).toFixed(2)}, Remaining: £${remainingToRefund.toFixed(2)}`
            });
        }

        // Update task status based on total refunded across ALL payment histories
        const updatedHistories = await PaymentHistory.find({ taskId });
        const newTotalRefunded = updatedHistories.reduce((sum, ph) => {
            return sum + (ph.refundedTotalGBP || 0);
        }, 0);
        const remainingAmount = totalPaidAcrossAll - newTotalRefunded;

        console.log("Total paid:", totalPaidAcrossAll, "Total refunded:", newTotalRefunded, "Remaining:", remainingAmount, "Refund amount:", refundAmount);

        if (remainingAmount <= 0) {
            task.paymentStatus = 'refunded';
        } else {
            task.paymentStatus = 'partial_Refunded';
        }
        await task.save();

        // Send refund email (use the first payment history for email)
        await sendRefundEmail({ task, paymentHistory: availableHistories[0].paymentHistory, refundAmount });

        // Build response message
        const gatewayInfo = isCrossPlatform
            ? `across ${uniqueGateways.length} different gateways (${uniqueGateways.join(', ')})`
            : `using ${uniqueGateways[0]}`;

        return res.status(200).json({
            message: `Refund of £${refundAmount.toFixed(2)} processed successfully across ${refundResults.length} payment(s) ${gatewayInfo}`,
            remainingAmount,
            totalRefunded: newTotalRefunded,
            totalPaid: totalPaidAcrossAll,
            isCrossPlatform,
            refundDetails: refundResults
        });
    } catch (error) {
        console.error("Error processing refund:", error);
        res.status(500).json({ message: "Error processing refund", error: error.message });
    }
};
