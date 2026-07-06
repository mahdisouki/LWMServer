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
    suggestReplyContext: { type: [suggestReplyThreadRowSchema], default: [] },
    subject: { type: String, default: '' },
    to: { type: String, default: '' },
    reply: { type: String, default: '' },
    attachments: {
      type: [
        {
          filename: { type: String, default: '' },
          mimetype: { type: String, default: '' },
          size: { type: Number, default: 0 },
        },
      ],
      default: [],
    },
    sentAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

emailReplyLogSchema.index({ adminId: 1, threadId: 1, sentAt: -1 });
emailReplyLogSchema.index({ adminId: 1, replySource: 1, sentAt: -1 });

module.exports = mongoose.model('EmailReplyLog', emailReplyLogSchema);
