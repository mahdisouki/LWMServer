const mongoose = require('mongoose');
const { Schema } = mongoose;

const seoAuditIssueSchema = new Schema({
  siteUrl: { type: String, required: true, index: true },
  issueKey: { type: String, required: true },
  title: { type: String, required: true },
  severity: { type: String, enum: ['critical', 'high', 'medium', 'low'], required: true, index: true },
  affectedPageCount: { type: Number, default: 0 },
  impactSummary: { type: String },
  description: { type: String },
  affectedUrls: [{ type: String }],
  expectedImprovement: { type: String },
  aiFixSteps: [{ type: String }],
  refreshJobId: { type: Schema.Types.ObjectId, ref: 'SeoRefreshJob' },
}, { timestamps: true });

seoAuditIssueSchema.index({ siteUrl: 1, issueKey: 1 }, { unique: true });

module.exports = mongoose.model('SeoAuditIssue', seoAuditIssueSchema);
