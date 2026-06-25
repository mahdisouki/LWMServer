const mongoose = require('mongoose');
const { Schema } = mongoose;

const seoRefreshJobSchema = new Schema({
  siteUrl: { type: String, required: true, index: true },
  status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued', index: true },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  triggeredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  errorMessage: { type: String, default: null },
  progress: {
    step: { type: String, default: null },
    percent: { type: Number, default: 0 },
  },
  stats: {
    pagesCrawled: { type: Number, default: 0 },
    issuesFound: { type: Number, default: 0 },
  },
}, { timestamps: true });

module.exports = mongoose.model('SeoRefreshJob', seoRefreshJobSchema);
