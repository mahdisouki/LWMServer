const mongoose = require('mongoose');
const { Schema } = mongoose;

const paymentLinkSchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    provider: { type: String, enum: ['stripe', 'paypal'], required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    paymentType: { type: String, enum: ['deposit', 'remaining', 'total', 'partial'], default: 'total' },
    amountToPay: { type: Number, required: true },
    status: { type: String, enum: ['active', 'used', 'cancelled'], default: 'active', index: true },
    usedAt: { type: Date, default: null },
    lastRefreshedAt: { type: Date, default: null },
    refreshCount: { type: Number, default: 0 },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

module.exports = mongoose.model('PaymentLink', paymentLinkSchema);
