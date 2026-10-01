const mongoose = require('mongoose');

const quoteItemSchema = new mongoose.Schema(
  {
    item_name: { type: String, default: '' },
    phrase: { type: String, default: '' },
    quantity: { type: Number, default: 0 },
    price: { type: Number, default: null },
    final_price: { type: Number, default: null },
    inside: { type: Number, default: null },
    inside_with_dismantling: { type: Number, default: null },
    type: { type: String, default: null },
    item_id: { type: String, default: null },
    position: { type: String, default: null },
    status: { type: String, default: null },
  },
  { _id: false }
);

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
    quoteItems: { type: [quoteItemSchema], default: [] },
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
