const mongoose = require('mongoose');

/** Sticky ownership after reply / open / reassign / takeover. */
const emailContactOwnerSchema = new mongoose.Schema(
  {
    mailboxEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    contactEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    ownerAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    claimSource: {
      type: String,
      enum: ['reply', 'open', 'reassign', 'takeover'],
      default: null,
    },
    lastThreadId: { type: String, default: null },
    lastAssignedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

emailContactOwnerSchema.index(
  { mailboxEmail: 1, contactEmail: 1 },
  { unique: true }
);

module.exports = mongoose.model('EmailContactOwner', emailContactOwnerSchema);
