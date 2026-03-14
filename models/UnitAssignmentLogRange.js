const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * One continuous assignment period: who was on which truck from start to end.
 * Unlike UnitAssignmentLog (event-based: assigned/deassigned), each document is a range [startAt, endAt].
 */
const unitAssignmentLogRangeSchema = new Schema(
  {
    truckId: { type: Schema.Types.ObjectId, ref: 'Truck', required: true },
    type: { type: String, enum: ['van', 'driver', 'helper'], required: true },
    refId: { type: Schema.Types.ObjectId, required: true }, // Van, Driver, or Helper _id (model from type)
    startAt: { type: Date, required: true },
    endAt: { type: Date }, // null = still active
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String },
  },
  { timestamps: true }
);

unitAssignmentLogRangeSchema.virtual('refIdCollection').get(function () {
  return this.type === 'van' ? 'Van' : 'User';
});

unitAssignmentLogRangeSchema.index({ truckId: 1, startAt: 1 });
unitAssignmentLogRangeSchema.index({ truckId: 1, endAt: 1 });
unitAssignmentLogRangeSchema.index({ type: 1, refId: 1, startAt: -1 });

const UnitAssignmentLogRange = mongoose.model('UnitAssignmentLogRange', unitAssignmentLogRangeSchema);
module.exports = UnitAssignmentLogRange;
