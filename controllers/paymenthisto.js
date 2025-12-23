const PaymentHistory = require('../models/PaymentHistory');

// Get all payment histories
exports.getAllPaymentHistories = async (req, res) => {
    try {
        const paymentHistories = await PaymentHistory.find().populate('taskId', 'firstName lastName phoneNumber');
        res.status(200).json(paymentHistories);
    } catch (error) {
        console.error("Error fetching all payment histories:", error);
        res.status(500).json({ message: "Error fetching all payment histories", error: error.message });
    }
};

// Get payment history by ID
exports.getPaymentHistoryById = async (req, res) => {
    const { id } = req.params;

    try {
        const paymentHistory = await PaymentHistory.findById(id).populate('taskId', 'firstName lastName phoneNumber');
        if (!paymentHistory) {
            return res.status(404).json({ message: "Payment history not found" });
        }
        res.status(200).json(paymentHistory);
    } catch (error) {
        console.error("Error fetching payment history by ID:", error);
        res.status(500).json({ message: "Error fetching payment history by ID", error: error.message });
    }
};

// Get payment history by task ID
exports.getPaymentHistoryByTaskId = async (req, res) => {
    const { taskId } = req.params;

    try {
        const paymentHistories = await PaymentHistory.find({ taskId }).populate('taskId', 'firstName lastName phoneNumber');
        if (!paymentHistories || paymentHistories.length === 0) {
            return res.status(404).json({ message: "No payment history found for this task" });
        }
        res.status(200).json(paymentHistories);
    } catch (error) {
        console.error("Error fetching payment history by task ID:", error);
        res.status(500).json({ message: "Error fetching payment history by task ID", error: error.message });
    }
};