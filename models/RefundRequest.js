const mongoose = require("mongoose");
const { Schema } = mongoose;

const refundRequestSchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 0.01 },
    reason: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["pending", "processing", "accepted", "refused"],
      default: "pending",
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewNote: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
    stripeRefundId: { type: String, default: null },
    stripeRefundStatus: { type: String, default: null },
    refundGateway: { type: String, enum: ['stripe', 'paypal'] },
  },
  { timestamps: true }
);

refundRequestSchema.index({ status: 1, createdAt: -1 });
refundRequestSchema.index({ taskId: 1, createdAt: -1 });

const RefundRequest = mongoose.model("RefundRequest", refundRequestSchema);
module.exports = RefundRequest;
