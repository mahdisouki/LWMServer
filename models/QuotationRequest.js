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
    enum: ['no response', 'price too high', 'other', 'task created'],
    required: false
  },
  customReason: {
    type: String,
    required: false
  },
  retargetingEmailSent: {
    type: Boolean,
    default: false
  },
  retargetingEmailSentAt: {
    type: Date,
    default: null
  },
  retargetingCoupon20Id: {
    type: Schema.Types.ObjectId,
    ref: 'Coupon',
    default: null
  },
  retargetingCoupon10Id: {
    type: Schema.Types.ObjectId,
    ref: 'Coupon',
    default: null
  },
  reminderDate: {
    type: Date,
    required: false,
    default: null
  },
  reminderSent: {
    type: Boolean,
    default: false
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
  const isTaskCreatedReason = this.reason === 'task created';

  // Determine status: accepted > rejected > pending
  // "task created" reason should result in accepted status
  if (hasOrder || isTaskCreatedReason) {
    return {
      status: 'accepted',
      statusDate: task ? task.createdAt : (this.updatedAt || this.createdAt),
      hasOrder: hasOrder
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
  const isTaskCreatedReason = this.reason === 'task created';

  if (hasOrder || isTaskCreatedReason) {
    return {
      status: 'accepted',
      statusDate: taskCreatedAt || (this.updatedAt || this.createdAt),
      hasOrder: hasOrder
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
