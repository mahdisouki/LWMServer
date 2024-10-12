const mongoose = require('mongoose');
const { Schema } = mongoose;

const dayoffSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  requestDate: { type: Date, default: Date.now, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['Pending', 'Approved', 'Denied'], default: 'Pending' },
  reason: { type: String }
});

const Dayoff = mongoose.model('Dayoff', dayoffSchema);


module.exports = Dayoff;