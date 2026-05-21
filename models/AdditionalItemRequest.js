const mongoose = require('mongoose');
const { Schema } = mongoose;

const additionalItemRequestSchema = new Schema(
  {
    parentTaskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    childTaskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    itemName: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 1 },
    Objectsposition: {
      type: String,
      enum: ['Inside', 'Outside', 'InsideWithDismantling'],
      default: 'Outside',
    },
    quotedPrice: { type: Number, default: null },
    paymentMethod: {
      type: String,
      enum: ['cash', 'BankTransfer', 'payment_link', 'partial_payment', 'online'],
      required: true,
    },
    media: [{ type: String }],
    status: {
      type: String,
      enum: ['pending_admin_quote', 'quoted', 'accepted', 'declined'],
      default: 'pending_admin_quote',
      index: true,
    },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    requestedByType: { type: String, enum: ['Driver', 'Helper', 'Admin'], required: false },
    quotedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    quotedAt: { type: Date, default: null },
    driverDecisionBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    driverDecisionAt: { type: Date, default: null },
    declineReason: { type: String, default: '' },
  },
  { timestamps: true },
);

additionalItemRequestSchema.index({ parentTaskId: 1, createdAt: -1 });
additionalItemRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('AdditionalItemRequest', additionalItemRequestSchema);
