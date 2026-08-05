const mongoose = require('mongoose');

// Break schema to store individual break entries
const breakSchema = new mongoose.Schema({
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: false },
  duration: { type: Number, required: false } // Duration in minutes
});
// User model - Add device array
const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true }, // Device identifier (unique per user, not globally)
  pushToken: { type: String, required: true },
  platform: { type: String, enum: ['ios', 'android'], required: true },
  deviceName: { type: String }, // e.g., "iPhone 12 Pro", "Samsung Galaxy"
  lastActive: { type: Date, default: Date.now },
  socketId: { type: String }, // Current socket connection (if online)
}, { timestamps: true });
const userSchema = new mongoose.Schema({

  email: { type: String, required: true, unique: true },
  officialEmail: { type: String },
  phoneNumber: { type: String, required: true },
  username: { type: String, required: true },
  firstName: { type: String },
  lastName: { type: String },
  devices: [deviceSchema],
  gender: {
    type: String,
    enum: ["Female", "Male", "Other"],
    default: "Other",
  },
  designation: { type: String },
  dateOfBirth: { type: Date },
  picture: { type: String },
  password: { type: String, required: true },
  role: {
    type: [String],
    enum: ["Admin", "Helper", "Driver", "HR", "Manager", "CM", "IT", "CEO", "Broker"]
  },
  address: { type: String },
  postcode: { type: String },
  CIN: { type: String },
  DriverLicense: { type: String },
  drivingLicenseFront: { type: String },
  drivingLicenseBack: { type: String },
  rightToWorkShareCode: { type: String },
  passport: { type: String },
  signedStarterForm: { type: String },
  AccountNumber: { type: String },
  AccountName: { type: String },
  SortNumber: { type: String },
  addressProof: { type: String },
  NatInsurance: { type: String },
  refreshToken: { type: String },
  lastLoginAt: { type: Date },
  lastLoginIp: { type: String },
  passwordResetToken: { type: String },
  passwordResetExpires: { type: Date },

  fcmToken: { type: String },
  apnsToken: { type: String }, // For backward compatibility
  totalHoursWorked: {
    type: Number,
    default: 0
  },
  totalSalary: {
    type: Number,
    default: 0
  },
  dayOffRequests: [
    {
      type: mongoose.Types.ObjectId,
      ref: 'Dayoff'
    }
  ],
  hourPrice: {
    type: Number,
    default: 0
  },
  extraHourPrice: {
    type: Number,
    default: 0
  },
  regularHours: {
    type: Number,
    default: 0
  },
  csvPermission: {
    type: Boolean,
    default: false
  },
  isStillWorking: {
    type: Boolean,
    default: true
  },
  terminationReason: {
    type: String,
    default: ''
  },
  truckId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Truck',

  },
  breaks: [breakSchema],
  oneSignalPlayerId: { type: String }, // OneSignal player ID for push notifications (legacy - kept for backward compatibility)
  oneSignalPlayerIds: [{ type: String }], // OneSignal player IDs array for mobile push notifications (multiple devices)
  oneSignalWebPlayerId: { type: String }, // OneSignal player ID for web push notifications (legacy - kept for backward compatibility)
  oneSignalWebPlayerIds: [{ type: String }], // OneSignal player IDs array for web push notifications (multiple browsers/devices)
}, { discriminatorKey: 'roleType' });

// Add compound index to ensure deviceId is unique per user (not globally)
userSchema.index({ _id: 1, 'devices.deviceId': 1 }, { unique: true });

const User = mongoose.model('User', userSchema);

module.exports = { User };
