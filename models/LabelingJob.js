const mongoose = require('mongoose');
const { Schema } = mongoose;

const boxSchema = new Schema(
  {
    // YOLO: x/y are normalized centers (0–1), width/height are normalized (0–1)
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    label: { type: String, required: true },
    score: { type: Number, required: false },
    source: {
      type: String,
      enum: ['yolo', 'human'],
      default: 'human',
    },
  },
  { _id: false }
);

const labelingJobSchema = new Schema(
  {
    source: {
      type: String,
      enum: ['quotation', 'order'],
      default: 'quotation',
      index: true,
    },
    quotationId: {
      type: Schema.Types.ObjectId,
      ref: 'QuotationRequest',
      required: false,
      default: null,
      index: true,
    },
    taskId: {
      type: Schema.Types.ObjectId,
      ref: 'Task',
      required: false,
      default: null,
      index: true,
    },
    orderNumber: { type: String, default: '' },
    imageUrl: { type: String, required: true },
    customerName: { type: String, default: '' },
    email: { type: String, default: '' },
    label: {
      type: String,
      default: null,
      index: true,
    },
    loadSize: {
      type: String,
      enum: ['1/4 Load', '1/2 Load', '3/4 Load', 'Full Load', null],
      default: null,
      index: true,
    },
    category: {
      type: String,
      enum: ['item', 'load', null],
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'predicted', 'labeled', 'skipped'],
      default: 'pending',
      index: true,
    },
    boxes: { type: [boxSchema], default: [] },
    predictedAt: { type: Date, default: null },
    labeledAt: { type: Date, default: null },
    skippedAt: { type: Date, default: null },
    labeledBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

labelingJobSchema.index({ imageUrl: 1 }, { unique: true });
labelingJobSchema.index({ status: 1, createdAt: -1 });

const LabelingJob = mongoose.model('LabelingJob', labelingJobSchema);
module.exports = LabelingJob;
