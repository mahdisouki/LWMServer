const mongoose = require('mongoose');

const NEGOTIATION_STATUSES = [
  'Open',
  'InProgress',
  'AwaitingCustomer',
  'Agreed',
  'Declined',
  'Closed',
];

const brokerNegotiationSchema = new mongoose.Schema(
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
      enum: NEGOTIATION_STATUSES,
      default: 'Open',
      index: true,
    },
    priority: {
      type: String,
      enum: ['High', 'Medium', 'Low'],
      default: 'Medium',
    },
    quotedAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    customerOffer: {
      type: Number,
      min: 0,
      default: null,
    },
    counterOffer: {
      type: Number,
      min: 0,
      default: null,
    },
    agreedAmount: {
      type: Number,
      min: 0,
      default: null,
    },
    followUpAt: {
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
  },
  { timestamps: true }
);

brokerNegotiationSchema.index({ companyName: 'text', referenceCode: 'text' });

const BrokerNegotiation = mongoose.model('BrokerNegotiation', brokerNegotiationSchema);

module.exports = BrokerNegotiation;
module.exports.NEGOTIATION_STATUSES = NEGOTIATION_STATUSES;
