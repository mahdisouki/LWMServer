const mongoose = require('mongoose');

const LEAD_STATUSES = [
  'Draft',
  'NewLead',
  'ContactAttempted',
  'Contacted',
  'WaitingForCustomer',
  'QuotationSent',
  'FollowUpRequired',
  'Negotiation',
  'Converted',
  'Lost',
];

const brokerLeadSchema = new mongoose.Schema(
  {
    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BrokerOrg',
      required: true,
      index: true,
    },
    companyName: {
      type: String,
      required: [
        function companyNameRequired() {
          return this.status !== 'Draft';
        },
        'Company name is required',
      ],
      trim: true,
      default: '',
    },
    contactName: {
      type: String,
      required: [
        function contactNameRequired() {
          return this.status !== 'Draft';
        },
        'Contact name is required',
      ],
      trim: true,
      default: '',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    status: {
      type: String,
      enum: LEAD_STATUSES,
      default: 'NewLead',
      index: true,
    },
    priority: {
      type: String,
      enum: ['High', 'Medium', 'Low'],
      default: 'Medium',
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
    followUpAt: {
      type: Date,
      default: null,
    },
    pipelineValue: {
      type: Number,
      min: 0,
      default: 0,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    customerType: {
      type: String,
      enum: ['Individual', 'Company'],
      default: 'Individual',
    },
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    jobTitle: { type: String, trim: true, default: '' },
    preferredLanguage: { type: String, trim: true, default: 'English' },
    preferredCommunication: { type: String, trim: true, default: 'Email' },
    customerCategory: { type: String, trim: true, default: 'Prospect' },
    existingCustomer: { type: Boolean, default: false },
    secondaryEmail: { type: String, trim: true, lowercase: true, default: '' },
    secondaryPhone: { type: String, trim: true, default: '' },
    mobile: { type: String, trim: true, default: '' },
    whatsapp: { type: String, trim: true, default: '' },
    preferredContactTime: { type: String, trim: true, default: '' },
    addressLine1: { type: String, trim: true, default: '' },
    addressLine2: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    postalCode: { type: String, trim: true, default: '' },
    region: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: 'United Kingdom' },
    industry: { type: String, trim: true, default: '' },
    billingAddress: { type: String, trim: true, default: '' },
    preferredCollectionDate: { type: Date, default: null },
    preferredCollectionTime: { type: String, trim: true, default: '' },
    preferredCollectionDays: { type: String, trim: true, default: '' },
    binSize: { type: String, trim: true, default: '' },
    leadTitle: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    customerNeed: { type: String, trim: true, default: '' },
    productSubtype: { type: String, trim: true, default: '' },
    estimatedQuantity: { type: String, trim: true, default: '' },
    expectedDecisionDate: { type: Date, default: null },
    expectedDeliveryDate: { type: Date, default: null },
    leadSource: { type: String, trim: true, default: '' },
    campaign: { type: String, trim: true, default: '' },
    tags: { type: String, trim: true, default: '' },
    internalComments: { type: String, trim: true, default: '' },
    assignedBroker: { type: String, trim: true, default: '' },
    team: { type: String, trim: true, default: '' },
    territory: { type: String, trim: true, default: '' },
    reminder: { type: String, trim: true, default: 'None' },
    activityLog: [
      {
        action: { type: String, required: true },
        detail: { type: String, default: '' },
        actorName: { type: String, default: '' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    communicationLogs: [
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

brokerLeadSchema.index({ companyName: 'text', contactName: 'text', email: 'text' });

const BrokerLead = mongoose.model('BrokerLead', brokerLeadSchema);

module.exports = BrokerLead;
module.exports.LEAD_STATUSES = LEAD_STATUSES;
