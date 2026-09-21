const mongoose = require('mongoose');

const WhatsAppMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppConversation',
      required: true,
      index: true,
    },
    waMessageId: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
    },
    direction: {
      type: String,
      enum: ['inbound', 'outbound'],
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'text',
        'image',
        'audio',
        'video',
        'document',
        'sticker',
        'location',
        'contacts',
        'reaction',
        'template',
        'interactive',
        'button',
        'unknown',
      ],
      default: 'text',
    },
    body: {
      type: String,
      default: '',
    },
    mediaId: {
      type: String,
      default: null,
    },
    mediaMimeType: {
      type: String,
      default: null,
    },
    mediaFilename: {
      type: String,
      default: null,
    },
    mediaUrl: {
      type: String,
      default: null,
    },
    caption: {
      type: String,
      default: '',
    },
    templateName: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
      default: 'pending',
    },
    statusError: {
      type: String,
      default: null,
    },
    sentByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    raw: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

WhatsAppMessageSchema.index({ conversationId: 1, timestamp: 1 });

module.exports = mongoose.model('WhatsAppMessage', WhatsAppMessageSchema);
