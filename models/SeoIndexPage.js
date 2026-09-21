const mongoose = require('mongoose');
const { Schema } = mongoose;

const seoIndexPageSchema = new Schema({
  siteUrl: { type: String, required: true, index: true },
  url: { type: String, required: true, trim: true },
  /** Crawl-derived indexability status (not Google's live index verdict). */
  status: {
    type: String,
    enum: ['indexable', 'blocked', 'error'],
    required: true,
    index: true,
  },
  reason: {
    type: String,
    enum: [
      'ok',
      'noindex',
      'fetch_error',
      'should_noindex_cart',
    ],
    default: 'ok',
  },
  inSitemap: { type: Boolean, default: true },
  hasNoindex: { type: Boolean, default: false },
  robotsMeta: { type: String, default: '' },
  title: { type: String, default: '' },
  canonical: { type: String, default: '' },
  isCartOrCheckout: { type: Boolean, default: false },
  errorMessage: { type: String, default: null },
  /** Weak GSC signal: page had search impressions in the lookback window. */
  gscImpressions: { type: Number, default: null },
  gscClicks: { type: Number, default: null },
  gscSignal: {
    type: String,
    enum: ['unknown', 'likely_indexed', 'no_impressions'],
    default: 'unknown',
  },
  /** Google URL Inspection (live index verdict). unknown = not inspected yet. */
  googleStatus: {
    type: String,
    enum: ['unknown', 'indexed', 'not_indexed', 'inspect_error'],
    default: 'unknown',
    index: true,
  },
  googleVerdict: { type: String, default: null },
  googleCoverageState: { type: String, default: null },
  googleIndexingState: { type: String, default: null },
  googleRobotsTxtState: { type: String, default: null },
  googlePageFetchState: { type: String, default: null },
  googleCanonical: { type: String, default: null },
  googleLastCrawlTime: { type: Date, default: null },
  inspectionResultLink: { type: String, default: null },
  lastInspectedAt: { type: Date, default: null },
  inspectError: { type: String, default: null },
  refreshJobId: { type: Schema.Types.ObjectId, ref: 'SeoRefreshJob', default: null },
  lastCrawledAt: { type: Date, default: null },
}, { timestamps: true });

seoIndexPageSchema.index({ siteUrl: 1, url: 1 }, { unique: true });
seoIndexPageSchema.index({ siteUrl: 1, status: 1 });
seoIndexPageSchema.index({ siteUrl: 1, googleStatus: 1 });

module.exports = mongoose.model('SeoIndexPage', seoIndexPageSchema);
