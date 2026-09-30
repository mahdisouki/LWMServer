const Task = require('../models/Task');
const PaymentHistory = require('../models/PaymentHistory');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
const { sendRefundEmail } = require('../services/emailsService');

function requireSuperAdmin(req, res) {
    if (!req.user?.isSuperAdmin) {
        res.status(403).json({
            message:
                'Only super admins can process refunds directly. Create a refund request instead.',
        });
        return false;
    }
    return true;
}

// PayPal Client setup
function PayPalClient() {
    const PAYPAL_MODE = process.env.PAYPAL_MODE || 'sandbox';
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error("PayPal credentials are required");
    }

    const environment = PAYPAL_MODE === 'live'
        ? new paypal.core.LiveEnvironment(clientId, clientSecret)
        : new paypal.core.SandboxEnvironment(clientId, clientSecret);

    return new paypal.core.PayPalHttpClient(environment);
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
    let gateway = String(paymentHistory.paymentType || '').toLowerCase();
    let refundId = null;
    let refundStatus = null;
    let rawPayload = null;
    let verified = false;

    if (paymentHistory.paymentType === 'Stripe') {
        const transactionId = paymentHistory.transactionId;
        
        // Determine if transactionId is a charge ID (ch_xxx) or payment_intent ID (pi_xxx)
        let refundParams = {
            amount: Math.round(amountToRefund * 100)
        };
        
        if (transactionId && transactionId.startsWith('ch_')) {
            // Use charge parameter for charge IDs
            refundParams.charge = transactionId;
        } else if (transactionId && transactionId.startsWith('pi_')) {
            // Use payment_intent parameter for payment_intent IDs
            refundParams.payment_intent = transactionId;
        } else if (transactionId && transactionId.startsWith('cs_')) {
            // Checkout session ID: retrieve session, then get payment_intent or charge
            const session = await stripe.checkout.sessions.retrieve(transactionId);
            const pi = session.payment_intent;
            const paymentIntentId = typeof pi === 'string' ? pi : (pi && pi.id ? pi.id : null);
            if (paymentIntentId) {
                const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
                if (paymentIntent.latest_charge) {
                    refundParams.charge = typeof paymentIntent.latest_charge === 'string'
                        ? paymentIntent.latest_charge
                        : paymentIntent.latest_charge.id;
                } else {
                    refundParams.payment_intent = paymentIntentId;
                }
            } else {
                throw new Error(`Checkout session ${transactionId} has no payment_intent. Cannot process refund.`);
            }
        } else {
            throw new Error(`Invalid Stripe transaction ID format: ${transactionId}. Expected charge ID (ch_xxx), payment_intent ID (pi_xxx), or checkout session ID (cs_xxx).`);
        }
        
        const refund = await stripe.refunds.create(refundParams);
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
    } else if (paymentHistory.paymentType === 'BankTransfer' || paymentHistory.paymentType === 'Cash') {
        // Manual refunds - no API call needed
        const paymentTypeLower = paymentHistory.paymentType.toLowerCase();
        refundId = `${paymentTypeLower}_refund_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        refundStatus = 'MANUAL_PROCESSED';
        verified = true;
        rawPayload = {
            type: paymentTypeLower,
            processedAt: new Date().toISOString(),
            note: `Manual ${paymentHistory.paymentType} refund processed`
        };
        // Set gateway based on payment type
        if (paymentHistory.paymentType === 'BankTransfer') {
            gateway = 'banktransfer';
        } else {
            gateway = 'cash';
        }
    }

    return { verified, refundId, refundStatus, rawPayload, gateway };
}

exports.processRefundInternal = async (req, res) => {
    const { taskId, refundAmount } = req.body;

    console.log("Refund request:", taskId, refundAmount);
    try {
        const task = await Task.findById(taskId).populate('items.standardItemId');
        if (!task) return res.status(404).json({ message: "Task not found" });

        // Find successful payment histories only (exclude failed e.g. expired checkout sessions)
        const paymentHistories = await PaymentHistory.find({ taskId, status: 'success' });
        if (!paymentHistories || paymentHistories.length === 0) {
            // Check if this is a cash or bank transfer payment that should use manual refund endpoint
            const isCash = task.paymentMethod === 'cash' ||
                task.paidAmount?.method === 'cash' ||
                task.remainingAmount?.method === 'cash';
            const isBankTransfer = task.paymentMethod === 'BankTransfer' ||
                task.paidAmount?.method === 'BankTransfer' ||
                task.remainingAmount?.method === 'BankTransfer';

            if (isCash || isBankTransfer) {
                return res.status(400).json({
                    message: "Cash and Bank Transfer refunds must be processed using the /refund/manual endpoint"
                });
            }

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

            // Use epsilon (0.01) to account for floating-point precision issues with currency
            // If remaining is less than a penny, consider it fully refunded
            if (remainingAmount <= 0.01) {
                task.paymentStatus = 'refunded';
            } else {
                task.paymentStatus = 'partial_Refunded';
            }
            await task.save();

            await sendRefundEmail({
                task,
                paymentHistory: singlePaymentHistory,
                refundAmount,
                isSplitRefund: false,
                refundDetails: []
            });

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

        // Use epsilon (0.01) to account for floating-point precision issues with currency
        // If remaining is less than a penny, consider it fully refunded
        if (remainingAmount <= 0.01) {
            task.paymentStatus = 'refunded';
        } else {
            task.paymentStatus = 'partial_Refunded';
        }
        await task.save();

        // Send refund email with split refund information
        await sendRefundEmail({
            task,
            paymentHistory: availableHistories[0].paymentHistory,
            refundAmount,
            isSplitRefund: refundResults.length > 1,
            refundDetails: refundResults
        });

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

exports.processRefund = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    return exports.processRefundInternal(req, res);
};

/**
 * Run refund logic and return { status, body } (for approval workflow).
 */
exports.runRefundForTask = async (taskId, refundAmount, user) => {
    const result = { status: 500, body: null };
    const mockRes = {
        status(code) {
            result.status = code;
            return this;
        },
        json(body) {
            result.body = body;
            return result;
        },
    };
    await exports.processRefundInternal(
        { body: { taskId, refundAmount }, user },
        mockRes,
    );
    return result;
};

/**
 * Process manual refund for Cash and Bank Transfer payments
 * Creates PaymentHistory if missing and tracks the refund
 */
exports.processManualRefundInternal = async (req, res) => {
    const { taskId, refundAmount, bankReference, notes } = req.body;

    try {
        if (!taskId || !refundAmount) {
            return res.status(400).json({ message: "Task ID and refund amount are required" });
        }

        const task = await Task.findById(taskId).populate('items.standardItemId');
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        // Determine payment method
        const isCash = task.paymentMethod === 'cash' ||
            task.paidAmount?.method === 'cash' ||
            task.remainingAmount?.method === 'cash';
        const isBankTransfer = task.paymentMethod === 'BankTransfer' ||
            task.paidAmount?.method === 'BankTransfer' ||
            task.remainingAmount?.method === 'BankTransfer';

        if (!isCash && !isBankTransfer) {
            return res.status(400).json({
                message: "This task is not paid via Cash or Bank Transfer. Use the standard refund endpoint for online payments."
            });
        }

        const paymentMethod = isCash ? 'Cash' : 'BankTransfer';
        const gateway = isCash ? 'cash' : 'banktransfer';

        // Calculate total paid from task amounts (cash/bank transfer may not have PaymentHistory)
        const depositAmount = task.paidAmount?.amount || 0;
        const remainingPaymentAmount = task.remainingAmount?.amount || 0;
        // For cash, also check cashReceived field
        const cashAmount = isCash ? (task.cashReceived || 0) : 0;
        const totalPaid = Math.max(depositAmount + remainingPaymentAmount, cashAmount);

        if (totalPaid <= 0) {
            return res.status(400).json({
                message: "Cannot determine total paid amount for this task"
            });
        }

        // Check existing payment histories
        const paymentHistories = await PaymentHistory.find({ taskId });
        const totalRefundedSoFar = paymentHistories.reduce((sum, ph) => {
            return sum + (ph.refundedTotalGBP || 0);
        }, 0);

        const availableToRefund = totalPaid - totalRefundedSoFar;

        if (refundAmount <= 0) {
            return res.status(400).json({ message: "Invalid refund amount" });
        }

        if (refundAmount > availableToRefund) {
            return res.status(400).json({
                message: `Refund amount exceeds available amount. Total paid: £${totalPaid.toFixed(2)}, Already refunded: £${totalRefundedSoFar.toFixed(2)}, Available: £${availableToRefund.toFixed(2)}`
            });
        }

        // Find or create PaymentHistory for this payment method
        let paymentHistory = paymentHistories.find(ph => ph.paymentType === paymentMethod);

        if (!paymentHistory) {
            // Create a PaymentHistory record if it doesn't exist
            paymentHistory = await PaymentHistory.create({
                taskId: task._id,
                firstName: task.firstName,
                lastName: task.lastName,
                phoneNumber: task.phoneNumber,
                amount: totalPaid,
                currency: 'GBP',
                paymentType: paymentMethod,
                paymentDate: task.date || new Date(),
                transactionId: `${gateway}_${task.orderNumber || task._id}_${Date.now()}`,
                payerAccount: task.email,
            });
        }

        // Process the manual refund
        const refundId = `${gateway}_refund_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create refund record with metadata
        const refundRecord = {
            refundId: refundId,
            gateway: gateway,
            amountGBP: Number(refundAmount),
            currency: 'GBP',
            status: 'MANUAL_PROCESSED',
            createdAt: new Date(),
            metadata: {
                type: gateway,
                processedAt: new Date().toISOString(),
                bankReference: bankReference || null,
                notes: notes || null,
                processedBy: req.user?._id || null,
            }
        };

        // Update PaymentHistory with refund
        await PaymentHistory.updateOne(
            { _id: paymentHistory._id },
            {
                $push: { refunds: refundRecord },
                $inc: { refundedTotalGBP: Number(refundAmount) }
            }
        );

        // Update task payment status
        const updatedHistories = await PaymentHistory.find({ taskId });
        const newTotalRefunded = updatedHistories.reduce((sum, ph) => {
            return sum + (ph.refundedTotalGBP || 0);
        }, 0);
        const remainingAmount = totalPaid - newTotalRefunded;

        if (remainingAmount <= 0.01) {
            task.paymentStatus = 'refunded';
        } else {
            task.paymentStatus = 'partial_Refunded';
        }
        await task.save();

        // Send refund email
        await sendRefundEmail({
            task,
            paymentHistory: paymentHistory,
            refundAmount,
            isSplitRefund: false,
            refundDetails: [{
                paymentHistoryId: paymentHistory._id,
                transactionId: paymentHistory.transactionId,
                gateway: paymentMethod, // Display name
                amount: refundAmount
            }]
        });

        return res.status(200).json({
            message: `${paymentMethod} refund of £${refundAmount.toFixed(2)} processed successfully`,
            refundId: refundId,
            paymentMethod: paymentMethod,
            remainingAmount,
            totalRefunded: newTotalRefunded,
            totalPaid: totalPaid,
            bankReference: bankReference || null
        });

    } catch (error) {
        console.error("Error processing manual refund:", error);
        res.status(500).json({
            message: "Error processing manual refund",
            error: error.message
        });
    }
};

exports.processManualRefund = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    return exports.processManualRefundInternal(req, res);
};

exports.runManualRefundForTask = async (taskId, refundAmount, user, extra = {}) => {
    const result = { status: 500, body: null };
    const mockRes = {
        status(code) {
            result.status = code;
            return this;
        },
        json(body) {
            result.body = body;
            return result;
        },
    };
    await exports.processManualRefundInternal(
        {
            body: {
                taskId,
                refundAmount,
                bankReference: extra.bankReference,
                notes: extra.notes,
            },
            user,
        },
        mockRes,
    );
    return result;
};
