const mongoose = require('mongoose');
const { Schema } = mongoose;

const couponSchema = new Schema({
  type: {
    type: String,
    enum: ['random', 'custom'],
    default: 'random'
  },
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true
  },
  // Random coupon fields
  percentage: {
    type: Number,
    required: function () { return this.type === 'random'; },
    min: 0,
    max: 100
  },
  expirationDuration: {
    type: Number, // Duration in hours
    required: function () { return this.type === 'random'; },
    min: 0
  },
  // Custom coupon fields
  startDate: {
    type: Date,
    required: function () { return this.type === 'custom'; }
  },
  endDate: {
    type: Date,
    required: function () { return this.type === 'custom'; }
  },
  discountType: {
    type: String,
    enum: ['percentage', 'amount'],
    required: function () { return this.type === 'custom'; }
  },
  discountValue: {
    type: Number,
    required: function () { return this.type === 'custom'; },
    min: 0
  },
  minimumOrderAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  maxUsagePerCustomer: {
    type: Number,
    default: null // null means unlimited per customer
  },
  usedBy: {
    type: [String], // Array of customer emails
    default: []
  },
  // Common fields
  isExpired: {
    type: Boolean,
    default: false
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
  },
  /** Client IP that minted an exit-intent coupon — one mint per IP per 24h; reuse only while unused and unexpired. */
  mintedForIp: {
    type: String,
    default: null,
    index: true
  },
  /** Set when the user scratches/reveals the exit-intent code — 5-minute checkout window starts here. */
  revealedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

// Pre-save hook to calculate expiresAt based on expirationDuration (random) or endDate (custom)
couponSchema.pre('save', function (next) {
  if (this.type === 'random' && this.isNew && this.expirationDuration) {
    this.expiresAt = new Date(Date.now() + (this.expirationDuration * 60 * 60 * 1000));
  } else if (this.type === 'custom' && this.endDate) {
    this.expiresAt = this.endDate;
  }
  next();
});

// Virtual to check if coupon is currently valid
couponSchema.virtual('isValid').get(function () {
  if (this.isExpired || !this.isActive) return false;
  if (this.maxUsage && this.usageCount >= this.maxUsage) return false;
  if (this.mintedForIp && !this.revealedAt) return false;
  if (new Date() > this.expiresAt) return false;
  return true;
});

// Method to validate and apply coupon
// For custom coupons: accepts customerEmail and cartTotal for validation
couponSchema.methods.validateCoupon = function (customerEmail = null, cartTotal = null) {
  // Check isActive (applies to both types)
  if (!this.isActive) {
    return { valid: false, message: 'Coupon is not active' };
  }

  // Random coupon validation (existing behavior)
  if (this.type === 'random') {
    if (this.isExpired) {
      return { valid: false, message: 'Coupon has been manually expired' };
    }
    if (this.maxUsage && this.usageCount >= this.maxUsage) {
      return { valid: false, message: 'Coupon has reached maximum usage limit' };
    }
    if (this.mintedForIp && !this.revealedAt) {
      return { valid: false, message: 'Coupon has not been unlocked yet' };
    }
    if (new Date() > this.expiresAt) {
      return { valid: false, message: 'Coupon has expired' };
    }
    return { valid: true, percentage: this.percentage, discountType: 'percentage', discountValue: this.percentage };
  }

  // Custom coupon validation
  if (this.type === 'custom') {
    const now = new Date();

    // Check date range
    if (this.startDate && now < this.startDate) {
      return { valid: false, message: 'Coupon is not yet valid' };
    }
    if (this.endDate && now > this.endDate) {
      return { valid: false, message: 'Coupon has expired' };
    }
    if (now > this.expiresAt) {
      return { valid: false, message: 'Coupon has expired' };
    }

    // Check total usage limit
    if (this.maxUsage && this.usageCount >= this.maxUsage) {
      return { valid: false, message: 'Coupon has reached maximum usage limit' };
    }

    // Check minimum order amount
    if (cartTotal !== null && cartTotal < this.minimumOrderAmount) {
      return { valid: false, message: `Minimum order amount of £${this.minimumOrderAmount.toFixed(2)} required` };
    }

    // Check per-customer usage limit
    if (customerEmail && this.maxUsagePerCustomer !== null) {
      const customerUsageCount = this.usedBy.filter(email => email.toLowerCase() === customerEmail.toLowerCase()).length;
      if (customerUsageCount >= this.maxUsagePerCustomer) {
        return { valid: false, message: 'You have reached the maximum usage limit for this coupon' };
      }
    }

    return {
      valid: true,
      discountType: this.discountType,
      discountValue: this.discountValue,
      percentage: this.discountType === 'percentage' ? this.discountValue : null
    };
  }

  return { valid: false, message: 'Invalid coupon type' };
};

// Method to increment usage count
// For custom coupons: accepts customerEmail to add to usedBy array
couponSchema.methods.incrementUsage = async function (customerEmail = null) {
  this.usageCount += 1;

  // For custom coupons, add email to usedBy array
  if (this.type === 'custom' && customerEmail) {
    this.usedBy.push(customerEmail);
  }

  await this.save();
};

// Method to decrement usage count when a coupon is removed from a task
couponSchema.methods.decrementUsage = async function (customerEmail = null) {
  if (this.usageCount > 0) {
    this.usageCount -= 1;
  }

  if (this.type === 'custom' && customerEmail) {
    const emailLower = customerEmail.toLowerCase();
    const idx = this.usedBy
      .map((email) => String(email).toLowerCase())
      .lastIndexOf(emailLower);
    if (idx !== -1) {
      this.usedBy.splice(idx, 1);
    }
  }

  await this.save();
};

const Coupon = mongoose.model('Coupon', couponSchema);
module.exports = Coupon;
