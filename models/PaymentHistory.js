const mongoose = require('mongoose');
const { Schema } = mongoose;

const paymentHistorySchema = new Schema({
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    amount: { type: Number, required: true },
    price: { type: Number, required: true },
   
    Objectsposition: { type: String, required: true },
    available: { type: String, required: true },
    
    paymentType: { type: String, required: true },
    paymentDate: { type: Date, default: Date.now },
    transactionId: { type: String, required: true }, // Unique ID for the payment (Stripe or PayPal)
    payerAccount: { type: String, required: true }   // User account or payment method details for refund
});

const PaymentHistory = mongoose.model('PaymentHistory', paymentHistorySchema);
module.exports = PaymentHistory;
