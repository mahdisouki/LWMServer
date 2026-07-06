/**
 * Test free SEO metrics (GSC + Open PageRank)
 *
 * Usage: node scripts/testSeoFreeMetrics.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { syncFreeMetrics } = require('../services/seo/seoFreeMetricsService');
const { getCompetitorsOverview } = require('../services/seo/seoCompetitorService');
const { getSiteUrl } = require('../config/seoConfig');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const siteUrl = getSiteUrl();

  console.log('Syncing free metrics for', siteUrl);
  const result = await syncFreeMetrics(siteUrl);
  console.log('Sync result:', JSON.stringify(result, null, 2));

  const overview = await getCompetitorsOverview(siteUrl);
  console.log('Overview:', JSON.stringify(overview, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
