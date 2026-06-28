const mongoose = require('mongoose');
const { Schema } = mongoose;

const seoKeywordSchema = new Schema({
  siteUrl: { type: String, required: true, index: true },
  keyword: { type: String, required: true, trim: true },
  volume: { type: Number, default: null },
  keywordDifficulty: { type: Number, default: null },
  position: { type: Number, default: null },
  positionChange: { type: Number, default: null },
  intent: { type: String, enum: ['commercial', 'informational', 'navigational', 'transactional', 'unknown'], default: 'unknown' },
  targetUrl: { type: String, default: '' },
  isTracked: { type: Boolean, default: true, index: true },
  isSuggestion: { type: Boolean, default: false, index: true },
  source: { type: String, enum: ['manual', 'gsc', 'import'], default: 'manual' },
}, { timestamps: true });

seoKeywordSchema.index({ siteUrl: 1, keyword: 1 }, { unique: true });

module.exports = mongoose.model('SeoKeyword', seoKeywordSchema);
