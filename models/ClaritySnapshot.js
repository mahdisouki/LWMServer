const mongoose = require('mongoose');
const { Schema } = mongoose;

const SNAPSHOT_TYPES = ['overview', 'top_pages', 'traffic_sources', 'devices'];

const claritySnapshotSchema = new Schema({
  snapshotType: {
    type: String,
    enum: SNAPSHOT_TYPES,
    required: true,
    index: true,
  },
  snapshotDate: {
    type: Date,
    required: true,
    index: true,
  },
  numOfDays: {
    type: Number,
    enum: [1, 2, 3],
    default: 1,
  },
  data: {
    type: Schema.Types.Mixed,
    required: true,
  },
  fetchedAt: {
    type: Date,
    required: true,
  },
}, {
  timestamps: true,
});

claritySnapshotSchema.index({ snapshotType: 1, snapshotDate: 1 }, { unique: true });

const ClaritySnapshot = mongoose.model('ClaritySnapshot', claritySnapshotSchema);

module.exports = ClaritySnapshot;
module.exports.SNAPSHOT_TYPES = SNAPSHOT_TYPES;
