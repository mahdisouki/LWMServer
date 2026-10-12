const mongoose = require('mongoose');
const { Schema } = mongoose;

const bookingHoldSchema = new Schema(
  {
    ip: { type: String, required: true, index: true },
    startedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model('BookingHold', bookingHoldSchema);
