const mongoose = require('mongoose');

const QUOTE_REQUEST_STATUSES = [
  'Draft',
  'Submitted',
  'InReview',
  'Quoted',
  'Rejected',
  'Cancelled',
];

const brokerQuoteRequestSchema = new mongoose.Schema(
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
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BrokerContact',
      default: null,
    },
    referenceCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: QUOTE_REQUEST_STATUSES,
      default: 'Draft',
      index: true,
    },
    companyName: {
      type: String,
      required: true,
      trim: true,
    },
    siteAddress: {
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
    estimatedValue: {
      type: Number,
      min: 0,
      default: 0,
    },
    quotedAmount: {
      type: Number,
      min: 0,
      default: null,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    activityLog: [
      {
        action: { type: String, required: true },
        detail: { type: String, default: '' },
        actorName: { type: String, default: '' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    mainQuotationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuotationRequest',
      default: null,
    },
  },
  { timestamps: true }
);

brokerQuoteRequestSchema.index({ companyName: 'text', referenceCode: 'text' });

const BrokerQuoteRequest = mongoose.model('BrokerQuoteRequest', brokerQuoteRequestSchema);

module.exports = BrokerQuoteRequest;
module.exports.QUOTE_REQUEST_STATUSES = QUOTE_REQUEST_STATUSES;
