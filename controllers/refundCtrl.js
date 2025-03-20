const RefundRequest = require('../models/RefundRequest');
const Task = require('../models/Task');
const PaymentHistory = require('../models/PaymentHistory');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
exports.createRefundRequest = async (req, res) => {
    const { taskId, paymentHistoryId, reason } = req.body;

    try {
      
        const task = await Task.findById(taskId);
        if (!task) return res.status(404).json({ message: "Task not found" });

        const paymentHistory = await PaymentHistory.findById(paymentHistoryId);
        if (!paymentHistory) return res.status(404).json({ message: "Payment history not found" });

      
        const refundRequest = new RefundRequest({
            taskId,
            paymentHistoryId,
            reason
        });

        await refundRequest.save();
        res.status(201).json({ message: "Refund request created successfully", refundRequest });
    } catch (error) {
        console.error("Error creating refund request:", error);
        res.status(500).json({ message: "Error creating refund request", error: error.message });
    }
};
exports.getRefundRequestById = async (req, res) => {
    const { id } = req.params;

    try {
        const refundRequest = await RefundRequest.findById(id)
            .populate('taskId')
            .populate('paymentHistoryId');
        
        if (!refundRequest) return res.status(404).json({ message: "Refund request not found" });

        res.status(200).json(refundRequest);
    } catch (error) {
        console.error("Error fetching refund request:", error);
        res.status(500).json({ message: "Error fetching refund request", error: error.message });
    }
};
exports.getAllRefundRequests = async (req, res) => {
    try {
        const refundRequests = await RefundRequest.find()
            .populate({
                path: 'taskId',
                select: 'firstName lastName phoneNumber', // Specify fields you want from Task
            })
            .populate({
                path: 'paymentHistoryId',
                select: 'amount paymentType paymentDate', // Specify fields you want from PaymentHistory
            });
        
        res.status(200).json(refundRequests);
    } catch (error) {
        console.error("Error fetching all refund requests:", error);
        res.status(500).json({ message: "Error fetching all refund requests", error: error.message });
    }
};

exports.deleteRefundRequest = async (req, res) => {
    const { id } = req.params;

    try {
        const refundRequest = await RefundRequest.findByIdAndDelete(id);
        if (!refundRequest) return res.status(404).json({ message: "Refund request not found" });

        res.status(200).json({ message: "Refund request deleted successfully" });
    } catch (error) {
        console.error("Error deleting refund request:", error);
        res.status(500).json({ message: "Error deleting refund request", error: error.message });
    }
};



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

exports.updateRefundRequestStatus = async (req, res) => {
    const { id } = req.params;
    const { status, refundAmount , reason } = req.body; // Add refundAmount for partial refund

    try {
        const refundRequest = await RefundRequest.findById(id);
        if (!refundRequest) return res.status(404).json({ message: "Refund request not found" });

        if (status === "refunded") {
            const paymentHistory = await PaymentHistory.findById(refundRequest.paymentHistoryId);
            if (!paymentHistory) return res.status(404).json({ message: "Payment history not found" });

            // Validate refund amount
            if (!refundAmount || refundAmount <= 0) {
                return res.status(400).json({ message: "Invalid refund amount" });
            }
            if (refundAmount > paymentHistory.amount) {
                return res.status(400).json({ message: "Refund amount exceeds payment amount" });
            }

            let refundVerified = false;

            if (paymentHistory.paymentType === 'stripe') {
                const refund = await stripe.refunds.create({
                    payment_intent: paymentHistory.transactionId,
                    amount: Math.round(refundAmount * 100) // Convert to cents
                });
                refundVerified = await verifyStripeRefund(refund.id);
            } else if (paymentHistory.paymentType === 'paypal') {
                try {
                    const request = new paypal.payments.CapturesRefundRequest(paymentHistory.transactionId);
                    request.requestBody({
                        amount: {
                            value: refundAmount.toFixed(2), // Ensure proper format
                            currency_code: 'GBP'
                        }
                    });
                    const refund = await PayPalClient().execute(request);
                    refundVerified = await verifyPayPalRefund(refund.result.id);
                } catch (error) {
                    if (error.statusCode === 422 && error.message.includes("CAPTURE_FULLY_REFUNDED")) {
                        console.log("Capture already fully refunded");
                        refundVerified = true;
                    } else {
                        throw error;
                    }
                }
            }

            if (refundVerified) {
                refundRequest.status = "refunded";
                refundRequest.refundedAmount = refundAmount;
                refundRequest.remainingAmount = paymentHistory.amount - refundAmount;
                refundRequest.reason = reason;
                if (refundRequest.remainingAmount <= 0) {
                    await Task.findByIdAndUpdate(paymentHistory.taskId, { paymentStatus: 'Refunded' });
                }
            } else {
                return res.status(400).json({ message: "Refund verification failed" });
            }
        }

        refundRequest.status = status;
        await refundRequest.save();
        res.status(200).json({ message: `Refund request ${status} successfully`, refundRequest });
    } catch (error) {
        console.error("Error updating refund request status:", error);
        res.status(500).json({ message: "Error updating refund request", error: error.message });
    }
};


