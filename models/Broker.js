const mongoose = require('mongoose');

const brokerSchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: [true, 'Company name is required'],
      trim: true,
    },
    brokerCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
    contactName: {
      type: String,
      required: [true, 'Contact name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    commissionType: {
      type: String,
      enum: ['Percentage', 'Fixed'],
      default: 'Percentage',
    },
    commissionValue: {
      type: Number,
      required: true,
      min: 0,
      default: 10,
    },
    commissionPaymentDays: {
      type: Number,
      min: 0,
      default: 30,
    },
    accountManagerName: { type: String, trim: true, default: '' },
    accountManagerEmail: { type: String, trim: true, lowercase: true, default: '' },
    accountManagerPhone: { type: String, trim: true, default: '' },
    bankAccountName: { type: String, trim: true, default: '' },
    bankSortCode: { type: String, trim: true, default: '' },
    bankAccountNumber: { type: String, trim: true, default: '' },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

brokerSchema.index({ companyName: 'text', contactName: 'text', email: 'text', brokerCode: 'text' });
brokerSchema.index({ status: 1 });
brokerSchema.index({ commissionType: 1 });

// Model name BrokerOrg avoids clash with User discriminator "Broker"
const BrokerOrg = mongoose.model('BrokerOrg', brokerSchema, 'brokers');

module.exports = BrokerOrg;
