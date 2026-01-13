const mongoose = require('mongoose');
const { Schema } = mongoose;

const couponSchema = new Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true
  },
  percentage: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  isExpired: {
    type: Boolean,
    default: false
  },
  expirationDuration: {
    type: Number, // Duration in hours
    required: true,
    min: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  usageCount: {
    type: Number,
    default: 0
  },
  maxUsage: {
    type: Number,
    default: null // null means unlimited usage
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// Pre-save hook to calculate expiresAt based on expirationDuration
couponSchema.pre('save', function(next) {
  if (this.isNew && this.expirationDuration) {
    this.expiresAt = new Date(Date.now() + (this.expirationDuration * 60 * 60 * 1000));
  }
  next();
});

// Virtual to check if coupon is currently valid
couponSchema.virtual('isValid').get(function() {
  if (this.isExpired || !this.isActive) return false;
  if (this.maxUsage && this.usageCount >= this.maxUsage) return false;
  if (new Date() > this.expiresAt) return false;
  return true;
});

// Method to validate and apply coupon
couponSchema.methods.validateCoupon = function() {
  if (this.isExpired) {
    return { valid: false, message: 'Coupon has been manually expired' };
  }
  if (!this.isActive) {
    return { valid: false, message: 'Coupon is not active' };
  }
  if (this.maxUsage && this.usageCount >= this.maxUsage) {
    return { valid: false, message: 'Coupon has reached maximum usage limit' };
  }
  if (new Date() > this.expiresAt) {
    return { valid: false, message: 'Coupon has expired' };
  }
  return { valid: true, percentage: this.percentage };
};

// Method to increment usage count
couponSchema.methods.incrementUsage = async function() {
  this.usageCount += 1;
  await this.save();
};

const Coupon = mongoose.model('Coupon', couponSchema);
module.exports = Coupon;
