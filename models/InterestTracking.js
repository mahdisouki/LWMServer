const mongoose = require('mongoose');
const { Schema } = mongoose;

const interestTrackingSchema = new Schema({
  type: {
    type: String,
    enum: ['sunday_click', 'night_slot_click', 'today_unavailable_call_click'],
    required: true,
    index: true
  },
  date: {
    type: Date,
    required: true,
    index: true
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  },
  userAgent: {
    type: String
  },
  ipAddress: {
    type: String
  }
}, {
  timestamps: true
});

// Compound index for efficient date range queries
interestTrackingSchema.index({ type: 1, date: 1 });
interestTrackingSchema.index({ createdAt: 1 });

const InterestTracking = mongoose.model('InterestTracking', interestTrackingSchema);
module.exports = InterestTracking;

