const mongoose = require("mongoose");
const { Schema } = mongoose;

const paymentHistorySchema = new Schema({
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    amount: { type: Number, required: true }, // Montant total
    currency: { type: String, default: "GBP" },
    paymentType: { type: String, enum: ["Stripe", "PayPal", "BankTransfer", "Cash"], required: true },
    paymentDate: { type: Date, default: Date.now },
    transactionId: { type: String, required: true },
    payerAccount: { type: String },
    cardLast4Digits: { type: String }, // Last 4 digits of the card number (for Stripe payments)
    status: {
        type: String,
        enum: ['success', 'failed', 'pending', 'refunded'],
        default: 'pending'
    },
    statusMessage: { type: String },
    errorMessage: { type: String },
    breakdown: [
        {
            itemDescription: { type: String }, // Description du standard item ou objet personnalisé
            quantity: { type: Number },
            price: { type: Number }, // Prix unitaire
            Objectsposition: { type: String, enum: ["Inside", "Outside", "InsideWithDismantling"] }, // Position de l'objet
        },
    ],
    // Refund tracking fields
    refunds: [{
        refundId: { type: String, required: true },
        gateway: { type: String, enum: ["stripe", "paypal", "banktransfer", "cash"], required: true },
        amountGBP: { type: Number, required: true },
        currency: { type: String, default: "GBP" },
        status: { type: String },
        createdAt: { type: Date, default: Date.now },
        metadata: { type: Schema.Types.Mixed }
    }],
    refundedTotalGBP: { type: Number, default: 0 }
});

const PaymentHistory = mongoose.model("PaymentHistory", paymentHistorySchema);
module.exports = PaymentHistory;
