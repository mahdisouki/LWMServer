/**
 * Refresh full item catalogue pricing in data/company-facts.json from live StandardItem rows.
 * Leaves company / hours / serviceModel / generalFAQ / unresolved / mattress policy text untouched.
 *
 * Usage:
 *   node scripts/refreshCompanyFactsPricing.js
 *   node scripts/refreshCompanyFactsPricing.js --dry-run
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const StandardItem = require('../models/StandardItem');

const dryRun = process.argv.includes('--dry-run');
const FACTS_PATH = path.join(__dirname, '..', 'data', 'company-facts.json');

function toPrice(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Number(value);
}

function stripHtml(html) {
  if (!html || typeof html !== 'string') return null;
  const plain = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain || null;
}

function serializeItem(doc) {
  return {
    itemName: doc.itemName,
    outsidePrice: toPrice(doc.price),
    insidePrice: toPrice(doc.insidePrice),
    insideWithDismantlingPrice: toPrice(doc.insideWithDismantlingPrice),
    isHidden: Boolean(doc.isHidden),
    ewcCode: doc.ewcCode || null,
    spaceOfVan: doc.spaceOfVan ?? null,
    description: stripHtml(doc.description),
    sourceItemId: String(doc._id),
  };
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI or MONGODB_URI must be set in .env');

  const facts = JSON.parse(fs.readFileSync(FACTS_PATH, 'utf8'));

  await mongoose.connect(uri);

  const items = await StandardItem.find({})
    .select(
      'itemName price insidePrice insideWithDismantlingPrice isHidden ewcCode spaceOfVan description',
    )
    .sort({ itemName: 1 })
    .lean();

  const byItemName = {};
  for (const item of items) {
    if (!item.itemName) continue;
    byItemName[item.itemName] = serializeItem(item);
  }

  facts.catalogue = {
    note:
      "Full live StandardItem catalogue. outsidePrice = kerbside/outside collection; insidePrice and insideWithDismantlingPrice are additional when applicable. Use this as the source of truth for any item pricing or prep notes in descriptions. Refresh via: node scripts/refreshCompanyFactsPricing.js",
    updatedAt: new Date().toISOString(),
    itemCount: Object.keys(byItemName).length,
    byItemName,
  };

  // Keep mattress policy curated; drop the old mattress-only pricing block if present
  if (!facts.mattressSpecific) {
    facts.mattressSpecific = {};
  }
  facts.mattressSpecific.note =
    'Operational mattress rules only. For prices use companyFacts.catalogue.byItemName (filter itemName containing Mattress / Topper).';
  if (!facts.mattressSpecific.infestationPolicy) {
    facts.mattressSpecific.infestationPolicy =
      'If a mattress is infested (e.g. bed bugs), it must be wrapped in plastic and left outside at least 3 days prior to collection. Additional charges may apply. Customer must inform the company prior to booking.';
  }
  delete facts.mattressSpecific.pricing;
  delete facts.mattressSpecific.pricingUpdatedAt;

  const infestationHit = items.find(
    (row) =>
      typeof row.description === 'string' &&
      /bed\s*bug|infest|wrap/i.test(row.description),
  );
  if (infestationHit) {
    facts.mattressSpecific.infestationPolicySourceItem = infestationHit.itemName;
  }

  console.log(
    dryRun
      ? `[DRY RUN] Would write catalogue with ${facts.catalogue.itemCount} items`
      : `[LIVE] Writing catalogue with ${facts.catalogue.itemCount} items`,
  );
  console.log('Sample:', Object.keys(byItemName).slice(0, 8).join(', '), '…');

  if (!dryRun) {
    fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, 'utf8');
    console.log(`Updated ${FACTS_PATH}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
