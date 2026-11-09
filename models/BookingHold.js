const mongoose = require('mongoose');
const { Schema } = mongoose;

const bookingHoldSchema = new Schema(
  {
    ip: { type: String, required: true, index: true },
    startedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    /** Device that opened the exit popup and started this offer. */
    device: { type: String, enum: ['mobile', 'desktop', 'unknown'], default: 'unknown' },
  },
  { timestamps: true },
);

bookingHoldSchema.index({ createdAt: 1 });
bookingHoldSchema.index({ usedAt: 1 });

module.exports = mongoose.model('BookingHold', bookingHoldSchema);
