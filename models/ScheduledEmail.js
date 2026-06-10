const mongoose = require('mongoose');

const scheduledAttachmentSchema = new mongoose.Schema(
  {
    path: { type: String, required: true },
    originalname: { type: String, required: true },
    mimetype: { type: String, required: true },
    size: { type: Number, default: 0 },
  },
  { _id: false }
);

const scheduledEmailSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true,
      index: true,
    },
    to: { type: String, required: true },
    subject: { type: String, required: true },
    text: { type: String, required: true },
    attachments: { type: [scheduledAttachmentSchema], default: [] },
    scheduledAt: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'sending', 'sent', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    sentAt: { type: Date, default: null },
    gmailMessageId: { type: String, default: null },
  },
  { timestamps: true }
);

// Quick lookup for the cron worker
scheduledEmailSchema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.model('ScheduledEmail', scheduledEmailSchema);
