/**
 * Smoke-test paid search terms reporting against Google Ads.
 *
 * Usage:
 *   node scripts/testPaidSearchTerms.js
 *   node scripts/testPaidSearchTerms.js --preset 30d --limit 10
 */
require('dotenv').config();
const { getPaidSearchTerms } = require('../services/analytics/paidSearchTermsService');

function parseArgs(argv) {
  const args = { preset: '7d', limit: 10, startDate: null, endDate: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--preset' && argv[i + 1]) {
      args.preset = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--limit' && argv[i + 1]) {
      args.limit = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--startDate' && argv[i + 1]) {
      args.startDate = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--endDate' && argv[i + 1]) {
      args.endDate = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const data = await getPaidSearchTerms({
    preset: args.startDate && args.endDate ? undefined : args.preset,
    startDate: args.startDate || undefined,
    endDate: args.endDate || undefined,
    limit: args.limit,
  });

  console.log(JSON.stringify({
    period: data.period,
    totals: data.totals,
    meta: data.meta,
    sample: data.keywords.slice(0, 5),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
