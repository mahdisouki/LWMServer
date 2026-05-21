const mongoose = require('mongoose');
const { Schema } = mongoose;

const tempFileSchema = new Schema(
  {
    path: { type: String, required: true },
    mimetype: { type: String, default: '' },
    originalname: { type: String, default: '' },
  },
  { _id: false },
);

const taskPhotoUploadJobSchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    step: {
      type: String,
      enum: ['initial', 'intermediate', 'final', 'additional'],
      required: true,
    },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    description: { type: String, default: '' },
    paymentMethod: { type: String, default: '' },
    quantity: { type: Number, default: 1 },
    userType: { type: String, enum: ['Driver', 'Helper', 'Admin'], default: 'Driver' },
    actorName: { type: String, default: '' },
    tempFiles: [tempFileSchema],
    tempDir: { type: String, default: '' },
    cloudinaryUrls: [{ type: String }],
    additionalItemRequestId: { type: Schema.Types.ObjectId, ref: 'AdditionalItemRequest', default: null },
    error: { type: String, default: '' },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

taskPhotoUploadJobSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('TaskPhotoUploadJob', taskPhotoUploadJobSchema);
