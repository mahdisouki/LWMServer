const mongoose = require('mongoose');

const suggestReplyThreadRowSchema = new mongoose.Schema(
  {
    direction: { type: String, default: null },
    from: { type: String, default: null },
    subject: { type: String, default: null },
    contentMain: { type: String, default: null },
    sent_at: { type: String, default: null },
  },
  { _id: false }
);

const suggestReplyMessageSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    messageId: { type: String, default: null },
    threadId: { type: String, default: null },
    from: { type: String, default: null },
    to: { type: String, default: null },
    subject: { type: String, default: null },
    contentMain: { type: String, default: null },
    direction: { type: String, default: null },
    is_quotation_form: { type: Boolean, default: false },
    aiCategory: { type: String, default: null },
  },
  { _id: false }
);

const suggestReplyContextSchema = new mongoose.Schema(
  {
    message: { type: suggestReplyMessageSchema, default: null },
    thread: { type: [suggestReplyThreadRowSchema], default: [] },
  },
  { _id: false }
);

const emailReplyLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true,
      index: true,
    },
    threadId: { type: String, required: true, trim: true, index: true },
    messageId: { type: String, required: true, trim: true },
    inReplyToMessageId: { type: String, required: true, trim: true },
    replySource: {
      type: String,
      enum: ['admin', 'ai', 'ai_edited'],
      required: true,
      index: true,
    },
    suggestedReplies: { type: [String], default: [] },
    suggestReplyContext: { type: suggestReplyContextSchema, default: null },
    subject: { type: String, default: '' },
    to: { type: String, default: '' },
    sentAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

emailReplyLogSchema.index({ adminId: 1, threadId: 1, sentAt: -1 });
emailReplyLogSchema.index({ adminId: 1, replySource: 1, sentAt: -1 });

module.exports = mongoose.model('EmailReplyLog', emailReplyLogSchema);
