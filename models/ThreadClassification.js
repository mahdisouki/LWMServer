const mongoose = require('mongoose');

const threadClassificationSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true,
      index: true,
    },
    threadId: { type: String, required: true, trim: true },
    messageId: { type: String, default: null },
    aiCategory: { type: String, default: null },
    confidence: { type: Number, default: null },
    reason: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'done', 'failed'],
      default: 'pending',
    },
    classifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

threadClassificationSchema.index({ adminId: 1, threadId: 1 }, { unique: true });
threadClassificationSchema.index({ adminId: 1, aiCategory: 1 });

module.exports = mongoose.model(
  'ThreadClassification',
  threadClassificationSchema
);
