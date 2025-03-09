const mongoose = require("mongoose");
const { Schema } = mongoose;

const refundRequestSchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    paymentHistoryId: { type: Schema.Types.ObjectId, ref: "PaymentHistory", required: true },
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ["created", "declined", "refunded", "partially_refunded"],
      default: "created"
    },
    refundedAmount: { type: Number, default: 0 }, // Tracks how much has been refunded
    remainingAmount: { type: Number, required: true }, // Amount left to refund
  },
  { timestamps: true }
);

const RefundRequest = mongoose.model("RefundRequest", refundRequestSchema);
module.exports = RefundRequest;
