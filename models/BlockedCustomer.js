const mongoose = require('mongoose');

const blockedCustomerSchema = new mongoose.Schema(
  {
    email: { type: String, default: '' },
    phones: { type: [String], default: [] },
    collectionAddressNormalized: { type: String, default: '' },
    customerName: { type: String, default: '' },
    reason: { type: String, required: true, trim: true },
    blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sourceTaskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
    active: { type: Boolean, default: true },
    unblockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    unblockedAt: { type: Date },
  },
  { timestamps: true },
);

blockedCustomerSchema.index({ email: 1, active: 1 });
blockedCustomerSchema.index({ phones: 1, active: 1 });
blockedCustomerSchema.index({ collectionAddressNormalized: 1, active: 1 });

const BlockedCustomer = mongoose.model('BlockedCustomer', blockedCustomerSchema);

module.exports = BlockedCustomer;
