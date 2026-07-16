const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema(
  {
    country: { type: String, default: null },
    region: { type: String, default: null },
    city: { type: String, default: null },
    ll: { type: [Number], default: undefined },
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    refreshTokenHash: {
      type: String,
      required: true,
      index: true,
    },
    ip: { type: String },
    userAgent: { type: String },
    deviceSummary: { type: String },
    location: { type: locationSchema, default: () => ({}) },
    lastActiveAt: { type: Date, default: Date.now },
    revokedAt: { type: Date },
    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    status: {
      type: String,
      enum: ['active', 'revoked', 'superseded', 'expired'],
      default: 'active',
      index: true,
    },
    roleSnapshot: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

sessionSchema.index({ userId: 1, status: 1 });
sessionSchema.index({ status: 1, lastActiveAt: -1 });
sessionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Session', sessionSchema);
