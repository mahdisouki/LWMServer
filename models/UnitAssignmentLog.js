const mongoose = require('mongoose');
const { Schema } = mongoose;

const unitAssignmentLogSchema = new Schema(
  {
    truckId: { type: Schema.Types.ObjectId, ref: 'Truck', required: true }, // unit (Truck)
    type: { type: String, enum: ['van', 'driver', 'helper'], required: true },
    refId: { type: Schema.Types.ObjectId, required: true }, // Van, Driver, or Helper _id
    event: { type: String, enum: ['assigned', 'deassigned'], required: true },
    startAt: { type: Date }, // set when event = 'assigned' (start date and time)
    endAt: { type: Date },   // set when event = 'deassigned' (end date and time)
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String },
  },
  { timestamps: true }
);

unitAssignmentLogSchema.index({ truckId: 1, createdAt: -1 });
unitAssignmentLogSchema.index({ type: 1, refId: 1, createdAt: -1 });
unitAssignmentLogSchema.index({ truckId: 1, startAt: 1 });
unitAssignmentLogSchema.index({ truckId: 1, endAt: 1 });

const UnitAssignmentLog = mongoose.model('UnitAssignmentLog', unitAssignmentLogSchema);
module.exports = UnitAssignmentLog;
