const mongoose = require('mongoose');
const { Schema } = mongoose;

const mailtoLeadSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    email: { type: String, default: null, index: true },
    gclid: { type: String, default: null },
    gbraid: { type: String, default: null },
    wbraid: { type: String, default: null },
    msclkid: { type: String, default: null },
    fbclid: { type: String, default: null },
    utm_source: { type: String, default: null },
    event: { type: String, default: null },
    lastSeenAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

mailtoLeadSchema.index({ email: 1, lastSeenAt: -1 });

module.exports = mongoose.model('MailtoLead', mailtoLeadSchema);
