const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Async route-optimizer jobs (e.g. compare-grouped).
 * Created on POST; completed via Python callback or Node-side sync fallback.
 */
const routeOptimizerJobSchema = new Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    kind: {
      type: String,
      enum: ['compare_grouped', 'compare_previews'],
      default: 'compare_grouped',
      index: true,
    },
    /** Extra context for finalize (e.g. jobGroupIds for compare_previews). */
    jobContext: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      // applying = callback accepted; persist running (acks Python before heavy work)
      enum: ['processing', 'applying', 'done', 'failed'],
      default: 'processing',
      index: true,
    },
    date: { type: String, required: true, index: true },
    truckIds: [{ type: Schema.Types.ObjectId, ref: 'Truck' }],
    requestPayload: { type: Schema.Types.Mixed, default: {} },
    result: { type: Schema.Types.Mixed, default: null },
    assignedCount: { type: Number, default: 0 },
    error: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

routeOptimizerJobSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('RouteOptimizerJob', routeOptimizerJobSchema);
