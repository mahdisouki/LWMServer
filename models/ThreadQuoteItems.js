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

const threadQuoteItemsSchema = new mongoose.Schema(
  {
    threadId: { type: String, required: true, trim: true, unique: true },
    messageId: { type: String, default: null },
    items: { type: [quoteItemSchema], default: [] },
    source: {
      type: String,
      enum: ['suggest_reply', 'manual'],
      default: 'suggest_reply',
    },
  },
  { timestamps: true }
);

threadQuoteItemsSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('ThreadQuoteItems', threadQuoteItemsSchema);
