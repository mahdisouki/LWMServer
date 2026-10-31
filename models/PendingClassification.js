const mongoose = require('mongoose');

/**
 * Durable queue for inbox email classification.
 * Survives Node restarts; drained with low priority vs suggest_reply.
 */
const pendingClassificationSchema = new mongoose.Schema(
  {
    threadId: { type: String, required: true, trim: true, unique: true },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'failed'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
  },
  { timestamps: true }
);

pendingClassificationSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model(
  'PendingClassification',
  pendingClassificationSchema
);
