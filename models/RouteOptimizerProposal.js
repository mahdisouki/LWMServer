const mongoose = require('mongoose');
const { Schema } = mongoose;

const routeOptimizerProposalSchema = new Schema(
  {
    comparisonId: { type: String, required: true, index: true },
    variant: { type: String, enum: ['auto', 'custom'], required: true },
    date: { type: String, required: true, index: true },
    truckIds: [{ type: Schema.Types.ObjectId, ref: 'Truck' }],
    status: {
      type: String,
      enum: ['pending', 'accepted', 'superseded', 'discarded', 'expired'],
      default: 'pending',
      index: true,
    },
    optimizerMode: { type: String, default: '' },
    routes: { type: Schema.Types.Mixed, default: {} },
    externalSummary: { type: Schema.Types.Mixed, default: {} },
    apiCallsUsed: { type: Number, default: 0 },
    jobGroupIds: [{ type: String }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    expiresAt: { type: Date, required: true, index: true },
    acceptedAt: { type: Date, default: null },
    error: { type: String, default: '' },
  },
  { timestamps: true },
);

routeOptimizerProposalSchema.index({ comparisonId: 1, variant: 1 });

module.exports = mongoose.model('RouteOptimizerProposal', routeOptimizerProposalSchema);
