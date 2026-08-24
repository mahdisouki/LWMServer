const mongoose = require('mongoose');
const { Schema } = mongoose;

const seoContentGapSchema = new Schema({
  siteUrl: { type: String, required: true, index: true },
  keyword: { type: String, required: true, trim: true },
  insight: { type: String, default: '' },
  volume: { type: Number, default: null },
  keywordDifficulty: { type: Number, default: null },
  competitorId: { type: Schema.Types.ObjectId, ref: 'SeoCompetitor', default: null },
  competitorName: { type: String, default: null },
  status: { type: String, enum: ['open', 'draft_created', 'dismissed'], default: 'open', index: true },
  blogId: { type: Schema.Types.ObjectId, ref: 'Blog', default: null },
  aiGenerated: { type: Boolean, default: false },
  needsReview: { type: [String], default: [] },
  refreshJobId: { type: Schema.Types.ObjectId, ref: 'SeoRefreshJob', default: null },
}, { timestamps: true });

seoContentGapSchema.index({ siteUrl: 1, keyword: 1 }, { unique: true });

module.exports = mongoose.model('SeoContentGap', seoContentGapSchema);
