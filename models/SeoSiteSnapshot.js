const mongoose = require('mongoose');
const { Schema } = mongoose;

const metricSchema = new Schema({
  value: { type: Number },
  unit: { type: String },
  status: { type: String, enum: ['good', 'needs_improvement', 'poor', 'unknown'], default: 'unknown' },
  displayValue: { type: String },
}, { _id: false });

const technicalCheckSchema = new Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  status: { type: String, enum: ['pass', 'warn', 'fail'], required: true },
  message: { type: String },
}, { _id: false });

const aiActionSchema = new Schema({
  priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  title: { type: String, required: true },
  description: { type: String },
}, { _id: false });

const seoSiteSnapshotSchema = new Schema({
  siteUrl: { type: String, required: true, unique: true, index: true },
  totalPages: { type: Number, default: 0 },
  domainAuthority: { type: Number, default: null },
  seoScore: { type: Number, default: 0 },
  liveMonitoring: { type: Boolean, default: false },
  lastRefreshedAt: { type: Date, default: null },
  refreshJobId: { type: Schema.Types.ObjectId, ref: 'SeoRefreshJob', default: null },
  siteHealth: {
    overallScore: { type: Number, default: 0 },
    scoreStatus: { type: String, enum: ['needs_work', 'good', 'excellent'], default: 'needs_work' },
    issueCounts: {
      critical: { type: Number, default: 0 },
      high: { type: Number, default: 0 },
      medium: { type: Number, default: 0 },
      low: { type: Number, default: 0 },
    },
    coreWebVitals: {
      lcp: metricSchema,
      fid: metricSchema,
      cls: metricSchema,
      ttfb: metricSchema,
    },
    indexCoverage: {
      indexed: { type: Number, default: 0 },
      notIndexed: { type: Number, default: 0 },
      blocked: { type: Number, default: 0 },
    },
    keyMetrics: {
      organicTrafficMonthly: { type: Number, default: null },
      sitemapPageCount: { type: Number, default: 0 },
      crawledPageCount: { type: Number, default: 0 },
    },
    technicalChecks: [technicalCheckSchema],
    aiActionPlan: [aiActionSchema],
  },
}, { timestamps: true });

module.exports = mongoose.model('SeoSiteSnapshot', seoSiteSnapshotSchema);
