const mongoose = require('mongoose');

/**
 * Durable storage for inbound webhook payloads.
 * Helps debug prod-only gateway issues when provider logs aren't available.
 */
const webhookEventLogSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true }, // e.g. 'paypal', 'stripe'
    eventId: { type: String, required: true }, // provider event id (best-effort)
    eventType: { type: String },
    resourceId: { type: String },
    status: {
      type: String,
      enum: ['received', 'processed', 'ignored', 'error'],
      default: 'received',
    },
    errorMessage: { type: String },
    // Store raw event payload for forensics (PayPal webhook bodies are typically small)
    payload: { type: mongoose.Schema.Types.Mixed },
    meta: { type: mongoose.Schema.Types.Mixed },
    receivedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
  },
  { minimize: false },
);

webhookEventLogSchema.index({ provider: 1, eventId: 1 }, { unique: true });
webhookEventLogSchema.index({ provider: 1, receivedAt: -1 });

module.exports = mongoose.model('WebhookEventLog', webhookEventLogSchema);

