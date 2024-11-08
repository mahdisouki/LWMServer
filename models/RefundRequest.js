const mongoose = require("mongoose");
const { Schema } = mongoose;

const refundRequestSchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    paymentHistoryId: { type: Schema.Types.ObjectId, ref: "PaymentHistory", required: true },
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ["created", "declined", "refunded"],
      default: "created"
    },
  },
  { timestamps: true }
);

const RefundRequest = mongoose.model("RefundRequest", refundRequestSchema);
module.exports = RefundRequest;
