const mongoose = require('mongoose');
const { Schema } = mongoose;

const quotationRequestSchema = new Schema({
  Name: { type: String, required: true },
  // DoorNumber: { type: String, required: true },
  // RoadName: { type: String, },
  email: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  // Town: { type: String },
  address: { type: String, required: true },
  postcode: { type: String, required: true },
  estimatedPrices: [{ name: { type: String }, price: { type: String } }],
  comments: { type: String, required: false },
  items: [{ type: String, required: false }],
  read: { type: Boolean, default: false },
  reason: {
    type: String,
    enum: ['no response', 'price too high', 'other'],
    required: false
  },
  customReason: {
    type: String,
    required: false
  },

  createdAt: { type: Date, default: Date.now }
}, { timestamps: true }); // Enable timestamps to get updatedAt

// Instance method to compute status based on associated Task and reason
quotationRequestSchema.methods.computeStatus = async function () {
  const Task = mongoose.model('Task');

  // Check if there's an associated order (Task)
  const task = await Task.findOne({ quotationId: this._id })
    .select('createdAt')
    .sort({ createdAt: 1 }); // Get the earliest task if multiple exist

  const hasOrder = !!task;
  const hasReason = this.reason && this.reason.trim() !== '';

  // Determine status: accepted > rejected > pending
  if (hasOrder) {
    return {
      status: 'accepted',
      statusDate: task.createdAt,
      hasOrder: true
    };
  } else if (hasReason) {
    return {
      status: 'rejected',
      statusDate: this.updatedAt || this.createdAt,
      hasOrder: false
    };
  } else {
    return {
      status: 'pending',
      statusDate: null,
      hasOrder: false
    };
  }
};

// Instance method to get status synchronously (for cases where Task info is already provided)
quotationRequestSchema.methods.getStatusSync = function (taskCreatedAt = null) {
  const hasOrder = !!taskCreatedAt;
  const hasReason = this.reason && this.reason.trim() !== '';

  if (hasOrder) {
    return {
      status: 'accepted',
      statusDate: taskCreatedAt,
      hasOrder: true
    };
  } else if (hasReason) {
    return {
      status: 'rejected',
      statusDate: this.updatedAt || this.createdAt,
      hasOrder: false
    };
  } else {
    return {
      status: 'pending',
      statusDate: null,
      hasOrder: false
    };
  }
};

const QuotationRequest = mongoose.model('QuotationRequest', quotationRequestSchema);
module.exports = QuotationRequest;
