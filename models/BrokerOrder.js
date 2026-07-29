const mongoose = require('mongoose');

const ORDER_STATUSES = [
  'Draft',
  'Confirmed',
  'InProgress',
  'Completed',
  'Cancelled',
];

const brokerOrderSchema = new mongoose.Schema(
  {
    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BrokerOrg',
      required: true,
      index: true,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BrokerLead',
      required: true,
      index: true,
    },
    negotiationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BrokerNegotiation',
      default: null,
      index: true,
    },
    quoteRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BrokerQuoteRequest',
      default: null,
      index: true,
    },
    referenceCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    companyName: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ORDER_STATUSES,
      default: 'Confirmed',
      index: true,
    },
    priority: {
      type: String,
      enum: ['High', 'Medium', 'Low'],
      default: 'Medium',
    },
    orderAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    commissionAmount: {
      type: Number,
      min: 0,
      default: null,
    },
    commissionStatus: {
      type: String,
      enum: ['Pending', 'Paid', 'Disputed'],
      default: 'Pending',
      index: true,
    },
    commissionPaidAt: {
      type: Date,
      default: null,
    },
    commissionDisputeNote: {
      type: String,
      trim: true,
      default: '',
    },
    wasteType: {
      type: String,
      trim: true,
      default: '',
    },
    frequency: {
      type: String,
      trim: true,
      default: '',
    },
    siteAddress: {
      type: String,
      trim: true,
      default: '',
    },
    scheduledAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    activityLog: [
      {
        action: { type: String, required: true },
        detail: { type: String, default: '' },
        actorName: { type: String, default: '' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    mainTaskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      default: null,
    },
  },
  { timestamps: true }
);

brokerOrderSchema.index({ companyName: 'text', referenceCode: 'text' });

const BrokerOrder = mongoose.model('BrokerOrder', brokerOrderSchema);

module.exports = BrokerOrder;
module.exports.ORDER_STATUSES = ORDER_STATUSES;
module.exports.COMMISSION_STATUSES = ['Pending', 'Paid', 'Disputed'];
