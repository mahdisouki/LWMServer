const mongoose = require('mongoose');

const DOCUMENT_TYPES = [
  'Quote',
  'Contract',
  'Invoice',
  'WasteTransferNote',
  'ProofOfService',
  'Identity',
  'Other',
];

const brokerDocumentSchema = new mongoose.Schema(
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
    },
    negotiationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BrokerNegotiation',
      default: null,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BrokerOrder',
      default: null,
    },
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BrokerTask',
      default: null,
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
    title: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: DOCUMENT_TYPES,
      default: 'Other',
      index: true,
    },
    mimeType: {
      type: String,
      default: '',
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    fileUrl: {
      type: String,
      required: true,
      trim: true,
    },
    fileSize: {
      type: Number,
      default: 0,
      min: 0,
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

brokerDocumentSchema.index({ companyName: 'text', title: 'text', referenceCode: 'text' });

const BrokerDocument = mongoose.model('BrokerDocument', brokerDocumentSchema);

module.exports = BrokerDocument;
module.exports.DOCUMENT_TYPES = DOCUMENT_TYPES;
