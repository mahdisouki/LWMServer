const mongoose = require('mongoose');

const labelClassSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    isYoloClass: {
      type: Boolean,
      default: false,
    },
    // Frozen YOLO class id for export/retrain. Base filtered classes are 0..n-1.
    // New classes (loads, Add class) get the next free index and never move.
    yoloIndex: {
      type: Number,
      default: null,
      index: true,
    },
    category: {
      type: String,
      enum: ['item', 'load'],
      default: 'item',
      index: true,
    },
  },
  { timestamps: true }
);

labelClassSchema.index({ name: 1 }, { unique: true });
labelClassSchema.index(
  { yoloIndex: 1 },
  { unique: true, partialFilterExpression: { yoloIndex: { $type: 'number' } } },
);

const LabelClass = mongoose.model('LabelClass', labelClassSchema);
module.exports = LabelClass;
