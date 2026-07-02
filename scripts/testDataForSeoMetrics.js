/**
 * Test DataForSEO domain metrics (requires DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD in .env)
 *
 * Usage: node scripts/testDataForSeoMetrics.js londonwastemanagement.com litta.co.uk
 */
require('dotenv').config();
const { fetchDomainMetrics, isDataForSeoEnabled } = require('../services/seo/dataForSeoService');

async function main() {
  const domains = process.argv.slice(2);
  if (!domains.length) {
    console.error('Usage: node scripts/testDataForSeoMetrics.js <domain> [domain2...]');
    process.exit(1);
  }

  if (!isDataForSeoEnabled()) {
    console.error('DataForSEO not configured. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in .env');
    process.exit(1);
  }

  for (const domain of domains) {
    console.log(`\nFetching metrics for ${domain}...`);
    const metrics = await fetchDomainMetrics(domain);
    console.log(JSON.stringify(metrics, null, 2));
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
