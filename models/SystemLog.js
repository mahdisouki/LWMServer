const mongoose = require('mongoose');

const systemLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  username: {
    type: String,
    required: true
  },
  action: {
    type: String,
    required: true,
    enum: ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'SEND_RETARGETING_EMAIL', 'OTHER']
  },
  entityType: {
    type: String,
    required: true,
    enum: [
      'TASK',
      'USER',
      'PAYROLL',
      'TRUCK',
      'DAILY_SHEET',
      'STAFF',
      'STANDARD_ITEM',
      'CUSTOMER',
      'TIPPING_REQUEST',
      'STORAGE',
      'STORAGE_PLACE',
      'SERVICE_CATEGORY',
      'TIPPING_PLACE',
      'BLOCKING_DAY',
      'COUPON',
      'BROKER',
      'OTHER'
    ]
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false
  },
  changes: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  }
});

module.exports = mongoose.model('SystemLog', systemLogSchema); 