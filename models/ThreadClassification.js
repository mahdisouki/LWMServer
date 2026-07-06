const mongoose = require('mongoose');

const threadClassificationSchema = new mongoose.Schema(
  {
    threadId: { type: String, required: true, trim: true, unique: true },
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

threadClassificationSchema.index({ aiCategory: 1 });
threadClassificationSchema.index({ aiCategory: 1, internalDate: -1 });
threadClassificationSchema.index({ status: 1, aiCategory: 1, internalDate: -1 });

module.exports = mongoose.model(
  'ThreadClassification',
  threadClassificationSchema
);
