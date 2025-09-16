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
      "Driver_Tracking",
      "Payroll",
      "Chat",
      "Standard_Items",
      "Tipping",
      "Storage",
      "Truck",
      "Day_Off",
      "Busy_Days",
      "Emails",
      "Quotations",
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
  read: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Notification = mongoose.model("Notification", notificationSchema);
module.exports = Notification;
