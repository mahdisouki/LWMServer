const mongoose = require('mongoose');
const { Schema } = mongoose;

const seoCompetitorSchema = new Schema({
  siteUrl: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  competitorUrl: { type: String, required: true, trim: true },
  domainAuthority: { type: Number, default: null },
  authorityScore: { type: Number, default: null },
  organicTrafficMonthly: { type: Number, default: null },
  keywordsCount: { type: Number, default: null },
  backlinksCount: { type: Number, default: null },
  trend: { type: String, enum: ['up', 'down', 'stable', 'unknown'], default: 'unknown' },
  lastSyncedAt: { type: Date, default: null },
  source: { type: String, enum: ['manual', 'import', 'api'], default: 'manual' },
}, { timestamps: true });

seoCompetitorSchema.index({ siteUrl: 1, competitorUrl: 1 }, { unique: true });

module.exports = mongoose.model('SeoCompetitor', seoCompetitorSchema);
