const mongoose = require('mongoose');
const { Schema } = mongoose;

const tawkLeadSchema = new Schema(
  {
    sessionId: { type: String, required: true, index: true },
    email: { type: String, default: null, index: true },
    phone: { type: String, default: null },
    phoneNormalized: { type: String, default: null, index: true },
    name: { type: String, default: null },
    gclid: { type: String, default: null },
    gbraid: { type: String, default: null },
    wbraid: { type: String, default: null },
    msclkid: { type: String, default: null },
    fbclid: { type: String, default: null },
    utm_source: { type: String, default: null },
    landingPage: { type: String, default: null },
    trafficSource: { type: String, default: null },
    event: { type: String, default: null },
    lastSeenAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

tawkLeadSchema.index({ email: 1, lastSeenAt: -1 });
tawkLeadSchema.index({ phoneNormalized: 1, lastSeenAt: -1 });
tawkLeadSchema.index({ name: 1, lastSeenAt: -1 });

module.exports = mongoose.model('TawkLead', tawkLeadSchema);
