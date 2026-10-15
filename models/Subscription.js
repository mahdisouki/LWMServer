const mongoose = require('mongoose');
const { Schema } = mongoose;

const BILLING_FREQUENCIES = ['Monthly', 'Yearly', 'One-time', 'Free', 'Variable'];
const STATUSES = ['Active', 'Cancelled', 'Trial'];
const CURRENCIES = ['USD', 'GBP'];
const PRICE_NOTES = ['free', 'ask_ads_team', 'approx'];
const COST_TYPES = ['Fixed', 'Variable'];

const subscriptionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    loginEmail: { type: String, default: '', trim: true, lowercase: true },
    link: { type: String, default: '', trim: true },
    category: { type: String, default: '', trim: true, index: true },

    amount: { type: Number, default: null, min: 0 },
    currency: {
      type: String,
      default: null,
      validate: {
        validator: (v) => v == null || CURRENCIES.includes(v),
        message: 'currency must be USD or GBP',
      },
    },
    priceNote: {
      type: String,
      default: null,
      validate: {
        validator: (v) => v == null || PRICE_NOTES.includes(v),
        message: 'priceNote must be free, ask_ads_team, or approx',
      },
    },
    billingFrequency: {
      type: String,
      enum: BILLING_FREQUENCIES,
      default: 'Monthly',
    },
    costType: {
      type: String,
      enum: COST_TYPES,
      default: 'Fixed',
      index: true,
    },

    status: { type: String, enum: STATUSES, default: 'Active', index: true },
    startDate: { type: Date, default: null },
    nextRenewalDate: { type: Date, default: null, index: true },

    remindDaysBefore: { type: Number, default: 7, min: 0 },
    reminderAdminId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    lastReminderSentAt: { type: Date, default: null },

    owner: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    passwordVaultLink: { type: String, default: '', trim: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

subscriptionSchema.index({ status: 1, nextRenewalDate: 1 });
subscriptionSchema.index({ name: 1 });

subscriptionSchema.statics.BILLING_FREQUENCIES = BILLING_FREQUENCIES;
subscriptionSchema.statics.STATUSES = STATUSES;
subscriptionSchema.statics.CURRENCIES = CURRENCIES;
subscriptionSchema.statics.PRICE_NOTES = PRICE_NOTES;
subscriptionSchema.statics.COST_TYPES = COST_TYPES;

const Subscription = mongoose.model('Subscription', subscriptionSchema);
module.exports = Subscription;
