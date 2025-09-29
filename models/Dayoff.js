const mongoose = require('mongoose');
const { Schema } = mongoose;

const dayoffSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  requestDate: { type: Date, default: Date.now, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  proofs: [{ type: String }],
  status: { type: String, enum: ['Pending', 'Approved', 'Denied'], default: 'Pending' },
  statusUpdateDate: { type: Date }, // Date when admin approved or denied the request
  reason: { type: String }
});

const Dayoff = mongoose.model('Dayoff', dayoffSchema);


module.exports = Dayoff;