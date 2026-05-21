const mongoose = require('mongoose');

const driverHelperProximityStateSchema = new mongoose.Schema(
  {
    truckId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Truck',
      required: true,
      index: true,
    },
    dateKey: {
      type: String,
      required: true,
      index: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      required: true,
    },
    helperId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Helper',
      required: true,
    },
    lastDistanceMeters: {
      type: Number,
      default: null,
    },
    milestonesReached: {
      type: [Number],
      default: [],
    },
    autoStartTriggered: {
      type: Boolean,
      default: false,
    },
    /** Driver pressed Start shift — en route to helper; payroll starts on arrival. */
    shiftStartRequestedAt: {
      type: Date,
      default: null,
    },
    /** Payroll was created automatically when driver reached helper start_location. */
    shiftAutoStartedAt: {
      type: Date,
      default: null,
    },
    arrivalTriggeredAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

driverHelperProximityStateSchema.index(
  { truckId: 1, dateKey: 1 },
  { unique: true, name: 'uniq_truck_day_proximity_state' }
);

module.exports = mongoose.model('DriverHelperProximityState', driverHelperProximityStateSchema);
