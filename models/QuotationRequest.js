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
  gclid: { type: String, required: false },
  gbraid: { type: String, required: false },
  wbraid: { type: String, required: false },
  msclkid: { type: String, required: false },
  fbclid: { type: String, required: false },
  utm_source: { type: String, required: false },
  googleAdsQuoteConversionSentAt: { type: Date, required: false },
  googleAdsConversionError: { type: String, required: false },
  isAiGenerated: { type: Boolean, default: false },
  aiGeneratedAt: { type: Date, required: false },
  createdByType: {
    type: String,
    enum: ['public', 'admin', 'broker'],
    default: 'public',
  },
  brokerId: {
    type: Schema.Types.ObjectId,
    ref: 'BrokerOrg',
    default: null,
  },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true }); // Enable timestamps to get updatedAt

// Status is derived only from `reason` (legacy-aligned stats)
quotationRequestSchema.methods.getStatusSync = function (taskCreatedAt = null) {
  if (this.reason === 'task created') {
    return {
      status: 'accepted',
      statusDate: taskCreatedAt || this.updatedAt || this.createdAt,
      hasOrder: !!taskCreatedAt,
    };
  }

  const hasReason = this.reason && this.reason.trim() !== '';
  if (hasReason) {
    return {
      status: 'rejected',
      statusDate: this.updatedAt || this.createdAt,
      hasOrder: false,
    };
  }

  return {
    status: 'pending',
    statusDate: null,
    hasOrder: false,
  };
};

quotationRequestSchema.methods.computeStatus = async function () {
  const Task = mongoose.model('Task');

  const task = await Task.findOne({
    quotationId: this._id,
    paymentStatus: { $ne: 'Failed' },
  })
    .select('createdAt')
    .sort({ createdAt: 1 });

  return this.getStatusSync(task ? task.createdAt : null);
};

const QuotationRequest = mongoose.model('QuotationRequest', quotationRequestSchema);
module.exports = QuotationRequest;
