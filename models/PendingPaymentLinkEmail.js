const mongoose = require('mongoose');

const pendingPaymentLinkEmailSchema = new mongoose.Schema(
  {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      required: true,
      index: true,
    },
    customerEmail: {
      type: String,
      required: true,
      index: true,
    },
    taskCreatedAt: { type: Date, required: true },
    scheduledAt: { type: Date, required: true, index: true },
    paymentType: { type: String, default: 'total' },
    status: {
      type: String,
      enum: ['pending', 'processing', 'sent', 'cancelled', 'skipped', 'failed'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

pendingPaymentLinkEmailSchema.index({ status: 1, scheduledAt: 1 });
pendingPaymentLinkEmailSchema.index({ customerEmail: 1, status: 1 });

module.exports = mongoose.model('PendingPaymentLinkEmail', pendingPaymentLinkEmailSchema);
