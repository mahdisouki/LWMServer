const mongoose = require("mongoose");
const { Schema } = mongoose;

const paymentHistorySchema = new Schema({
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    amount: { type: Number, required: true }, // Montant total
    currency: { type: String, default: "GBP" },
    paymentType: { type: String, enum: ["Stripe", "PayPal"], required: true },
    paymentDate: { type: Date, default: Date.now },
    transactionId: { type: String, required: true },
    payerAccount: { type: String },
    breakdown: [
        {
            itemDescription: { type: String }, // Description du standard item ou objet personnalisé
            quantity: { type: Number },
            price: { type: Number }, // Prix unitaire
            Objectsposition: { type: String, enum: ["Inside", "Outside", "InsideWithDismantling"] }, // Position de l'objet
        },
    ],
});

const PaymentHistory = mongoose.model("PaymentHistory", paymentHistorySchema);
module.exports = PaymentHistory;
