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
    latestMessageId: { type: String, default: null },
    snippet: { type: String, default: '' },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
    cc: { type: String, default: '' },
    subject: { type: String, default: '' },
    date: { type: String, default: '' },
    internalDate: { type: String, default: null },
    threadMessageCount: { type: Number, default: 1 },
    labelIds: { type: [String], default: [] },
  },
  { timestamps: true }
);

threadClassificationSchema.index({ adminId: 1, threadId: 1 }, { unique: true });
threadClassificationSchema.index({ adminId: 1, aiCategory: 1 });
threadClassificationSchema.index({ adminId: 1, aiCategory: 1, internalDate: -1 });

module.exports = mongoose.model(
  'ThreadClassification',
  threadClassificationSchema
);
