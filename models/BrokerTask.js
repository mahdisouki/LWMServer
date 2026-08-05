const mongoose = require('mongoose');

const TASK_STATUSES = ['Pending', 'InProgress', 'Completed', 'Cancelled', 'Snoozed'];

const TASK_TYPES = [
  'Call',
  'Email',
  'Meeting',
  'QuoteReminder',
  'NegotiationFollowUp',
  'OrderSchedule',
  'General',
];

const brokerTaskSchema = new mongoose.Schema(
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
    title: {
      type: String,
      required: true,
      trim: true,
    },
    companyName: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: TASK_TYPES,
      default: 'General',
      index: true,
    },
    status: {
      type: String,
      enum: TASK_STATUSES,
      default: 'Pending',
      index: true,
    },
    priority: {
      type: String,
      enum: ['High', 'Medium', 'Low'],
      default: 'Medium',
    },
    dueAt: {
      type: Date,
      default: null,
      index: true,
    },
    completedAt: {
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

brokerTaskSchema.index({ title: 'text', companyName: 'text', referenceCode: 'text' });

const BrokerTask = mongoose.model('BrokerTask', brokerTaskSchema);

module.exports = BrokerTask;
module.exports.TASK_STATUSES = TASK_STATUSES;
module.exports.TASK_TYPES = TASK_TYPES;
