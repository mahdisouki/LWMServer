const mongoose = require('mongoose');
const { Schema } = mongoose;
const { COST_CATEGORIES, COST_TYPES } = require('../config/runningCostCategories');

const manualRunningCostSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    category: {
      type: String,
      enum: COST_CATEGORIES,
      required: true,
      index: true,
    },
    costType: {
      type: String,
      enum: COST_TYPES,
      required: true,
      default: 'Variable',
      index: true,
    },
    date: { type: Date, required: true, index: true },
    note: { type: String, default: '', trim: true },
    receiptUrl: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

manualRunningCostSchema.index({ date: 1, category: 1 });

const ManualRunningCost = mongoose.model('ManualRunningCost', manualRunningCostSchema);
module.exports = ManualRunningCost;
