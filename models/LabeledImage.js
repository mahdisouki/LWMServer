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

const labeledImageSchema = new Schema(
  {
    jobId: {
      type: Schema.Types.ObjectId,
      ref: 'LabelingJob',
      required: true,
      unique: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['quotation', 'order'],
      default: 'quotation',
      index: true,
    },
    quotationId: {
      type: Schema.Types.ObjectId,
      ref: 'QuotationRequest',
      default: null,
    },
    taskId: {
      type: Schema.Types.ObjectId,
      ref: 'Task',
      default: null,
    },
    orderNumber: { type: String, default: '' },
    imageUrl: { type: String, required: true },
    customerName: { type: String, default: '' },
    email: { type: String, default: '' },
    category: {
      type: String,
      enum: ['item', 'load'],
      required: true,
      index: true,
    },
    label: { type: String, required: true, index: true },
    loadSize: {
      type: String,
      enum: ['1/4 Load', '1/2 Load', '3/4 Load', 'Full Load', null],
      default: null,
    },
    boxes: { type: [boxSchema], required: true },
    labeledBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    labeledAt: { type: Date, required: true },
    // null = never included in a dataset export (or re-labeled since last export)
    exportedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

labeledImageSchema.index({ imageUrl: 1 }, { unique: true });
labeledImageSchema.index({ category: 1, labeledAt: -1 });

const LabeledImage = mongoose.model('LabeledImage', labeledImageSchema);
module.exports = LabeledImage;
