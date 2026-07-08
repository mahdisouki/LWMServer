const mongoose = require('mongoose');

const clarityManualSyncSchema = new mongoose.Schema({
  dayKey: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  timezone: {
    type: String,
    required: true,
  },
  snapshotDate: {
    type: Date,
    required: true,
  },
  synced: {
    type: Number,
    required: true,
  },
  triggeredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('ClarityManualSync', clarityManualSyncSchema);
