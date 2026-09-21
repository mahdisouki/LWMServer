const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  type: {
    type: String,
    enum: [
      "Staff",
      "Orders",
      "Incidents",
      "Driver_Tracking",
      "Payroll",
      "Chat",
      "Standard_Items",
      "Tipping",
      "Storage",
      "Truck",
      "Unit_Management",
      "Day_Off",
      "Busy_Days",
      "Emails",
      "Quotations",
      "Payment",
      "Payment-failed",
      "Subscriptions",
      "WhatsApp",
    ],
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  senderName: {
    type: String,
    required: false,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  read: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Serves find({ userId, read }), updateMany({ userId, read }) and
// find({ userId }).sort({ createdAt: -1 }) without an in-memory sort.
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);
module.exports = Notification;
