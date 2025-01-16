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
    const { status } = req.body; // "refunded" or "declined"

    try {
        const refundRequest = await RefundRequest.findById(id);
        if (!refundRequest) return res.status(404).json({ message: "Refund request not found" });

        if (status === "refunded") {
            const paymentHistory = await PaymentHistory.findById(refundRequest.paymentHistoryId);
            if (!paymentHistory) return res.status(404).json({ message: "Payment history not found" });

            let refundVerified = false;

            if (paymentHistory.paymentType === 'stripe') {
                const refunds = await stripe.refunds.list({
                    payment_intent: paymentHistory.transactionId,
                });
                const existingRefund = refunds.data.find(refund => refund.status === 'succeeded');

                if (existingRefund) {
                    refundVerified = true;
                } else {
                    const refund = await stripe.refunds.create({
                        payment_intent: paymentHistory.transactionId,
                        amount: Math.round(paymentHistory.amount) // Assurez-vous que le montant est un entier
                    });
                    refundVerified = await verifyStripeRefund(refund.id);
                }
            } else if (paymentHistory.paymentType === 'paypal') {
                try {
                    const request = new paypal.payments.CapturesRefundRequest(paymentHistory.transactionId);
                    request.requestBody({
                        amount: {
                            value: (paymentHistory.amount ).toFixed(2), // Convertit en format PayPal
                            currency_code: 'GBP'
                        }
                    });
                    const refund = await PayPalClient().execute(request);
                    refundVerified = await verifyPayPalRefund(refund.result.id);
                } catch (error) {
                    if (error.statusCode === 422 && error.message.includes("CAPTURE_FULLY_REFUNDED")) {
                        console.log("Capture already fully refunded");
                        refundVerified = true; // Considérer comme vérifié si déjà remboursé
                    } else if (error.statusCode === 422 && error.message.includes("ORDER_ALREADY_CAPTURED")) {
                        console.log("Order already captured but not refunded");
                        refundVerified = false;
                    } else {
                        throw error;
                    }
                }
            }

            if (refundVerified) {
                await Task.findByIdAndUpdate(paymentHistory.taskId, { paymentStatus: 'Refunded' });
                refundRequest.status = "refunded";
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

