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
    enum: ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'OTHER']
  },
  entityType: {
    type: String,
    required: true,
    enum: ['TASK', 'USER', 'PAYROLL', 'TRUCK', 'DAILY_SHEET', 'OTHER']
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
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