const mongoose = require('mongoose');

/**
 * Designated-inbox ownership for a Gmail thread (My inbox).
 * Main INBOX is unchanged; this is an additive ownership layer.
 */
const emailThreadAssignmentSchema = new mongoose.Schema(
  {
    threadId: { type: String, required: true, trim: true },
    mailboxEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    mailboxAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assignmentSource: {
      type: String,
      enum: [
        'random',
        'sticky',
        'reassign',
        'rebalance',
        'takeover',
        'manual',
        'queued',
      ],
      default: 'random',
    },
    status: {
      type: String,
      enum: ['queued', 'open', 'flagged', 'closed'],
      default: 'open',
      index: true,
    },
    flaggedForAdvice: { type: Boolean, default: false, index: true },
    flagNote: { type: String, default: '' },
    flaggedAt: { type: Date, default: null },
    flaggedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    contactEmail: { type: String, default: '', trim: true, lowercase: true },
    latestMessageId: { type: String, default: null },
    subject: { type: String, default: '' },
    from: { type: String, default: '' },
    snippet: { type: String, default: '' },
    internalDate: { type: String, default: null },
  },
  { timestamps: true }
);

emailThreadAssignmentSchema.index(
  { mailboxEmail: 1, threadId: 1 },
  { unique: true }
);
emailThreadAssignmentSchema.index({ assignedTo: 1, updatedAt: -1 });
emailThreadAssignmentSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model(
  'EmailThreadAssignment',
  emailThreadAssignmentSchema
);
