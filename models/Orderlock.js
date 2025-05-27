const mongoose = require('mongoose');
const { Schema } = mongoose;

const orderLockSchema = new Schema({
  taskId: {
    type: Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
    unique: true
  },
  lockedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  lockedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  }
});

// Add TTL index for automatic cleanup of expired locks
orderLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const OrderLock = mongoose.model('OrderLock', orderLockSchema);
module.exports = OrderLock;