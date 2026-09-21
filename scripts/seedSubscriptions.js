/**
 * Seed SaaS / tool subscriptions from the internal tracking sheet.
 *
 * Usage:
 *   node scripts/seedSubscriptions.js --dry-run
 *   node scripts/seedSubscriptions.js
 *
 * Skips rows whose name already exists (case-insensitive).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Subscription = require('../models/Subscription');

const dryRun = process.argv.includes('--dry-run');

const SEED = [
  {
    name: 'MongoDB',
    description: 'Database',
    loginEmail: 'hello@londonwastemanagement.uk',
    link: 'https://www.mongodb.com/',
    category: 'Infrastructure',
    amount: 100,
    currency: 'USD',
    priceNote: 'approx',
    billingFrequency: 'Monthly',
  },
  {
    name: 'Cloudinary',
    description: 'Cloud platform for images',
    loginEmail: 'hello@londonwastemanagement.uk',
    link: 'https://cloudinary.com/',
    category: 'Infrastructure',
    amount: 34.8,
    currency: 'USD',
    priceNote: null,
    billingFrequency: 'Monthly',
  },
  {
    name: 'Ideal Postcodes',
    description: 'UK address lookup API',
    loginEmail: 'hello@londonwastemanagement.uk',
    link: 'https://account.ideal-postcodes.co.uk/user',
    category: 'Infrastructure',
    amount: 186,
    currency: 'GBP',
    priceNote: null,
    billingFrequency: 'Monthly',
  },
  {
    name: 'CookieYes',
    description: 'Cookie consent banner tool',
    loginEmail: 'hello@londonwastemanagement.uk',
    link: 'https://www.cookieyes.com/cookie-consent',
    category: 'Compliance',
    amount: 30,
    currency: 'USD',
    priceNote: null,
    billingFrequency: 'Monthly',
  },
  {
    name: 'Trustpilot',
    description: 'Customer review management platform',
    loginEmail: 'hello@londonwastemanagement.uk',
    link: 'https://fr.trustpilot.com/',
    category: 'Marketing',
    amount: null,
    currency: null,
    priceNote: 'free',
    billingFrequency: 'Free',
  },
  {
    name: 'Cursor',
    description: 'AI coding tool',
    loginEmail: 'hello@londonwastemanagement.uk',
    link: 'https://cursor.com',
    category: 'AI',
    amount: 20,
    currency: 'USD',
    priceNote: null,
    billingFrequency: 'Monthly',
  },
  {
    name: 'Google Ads',
    description: 'Paid search advertising',
    loginEmail: 'hello@londonwastemanagement.uk',
    link: 'https://ads.google.com/',
    category: 'Marketing',
    amount: null,
    currency: null,
    priceNote: 'ask_ads_team',
    billingFrequency: 'Variable',
  },
  {
    name: 'Microsoft Ads',
    description: 'Paid search advertising',
    loginEmail: 'hello@londonwastemanagement.uk',
    link: 'https://about.ads.microsoft.com/',
    category: 'Marketing',
    amount: null,
    currency: null,
    priceNote: 'ask_ads_team',
    billingFrequency: 'Variable',
  },
  {
    name: 'Microsoft Clarity',
    description: 'Website analytics tool',
    loginEmail: 'cyatrk2000@gmail.com',
    link: 'https://clarity.microsoft.com',
    category: 'Analytics',
    amount: null,
    currency: null,
    priceNote: 'free',
    billingFrequency: 'Free',
  },
  {
    name: 'Google Analytics',
    description: 'Web analytics platform',
    loginEmail: 'hello@londonwastemanagement.uk',
    link: 'https://analytics.google.com/',
    category: 'Analytics',
    amount: null,
    currency: null,
    priceNote: 'free',
    billingFrequency: 'Free',
  },
  {
    name: 'Google Search Console',
    description: "Monitors site's presence, indexing, and search performance",
    loginEmail: 'hello@londonwastemanagement.uk',
    link: 'https://search.google.com/search-console/',
    category: 'Analytics',
    amount: null,
    currency: null,
    priceNote: 'free',
    billingFrequency: 'Free',
  },
  {
    name: 'Mapbox',
    description: 'Mapping and location API',
    loginEmail: 'soukimahdi@gmail.com',
    link: 'https://www.mapbox.com/',
    category: 'Infrastructure',
    amount: null,
    currency: null,
    priceNote: 'free',
    billingFrequency: 'Free',
  },
  {
    name: 'Figma',
    description: 'Figma Pro design tool',
    loginEmail: 'hello@londonwastemanagement.uk',
    link: 'https://www.figma.com/',
    category: 'Design',
    amount: 50,
    currency: 'USD',
    priceNote: 'approx',
    billingFrequency: 'Monthly',
  },
];

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI or MONGO_URI must be set');

  await mongoose.connect(uri);
  console.log(`[Seed Subscriptions] Connected (${dryRun ? 'DRY RUN' : 'LIVE'})`);

  let created = 0;
  let skipped = 0;

  for (const row of SEED) {
    const existing = await Subscription.findOne({
      name: new RegExp(`^${row.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    }).select('_id name');

    if (existing) {
      skipped += 1;
      console.log(`  skip  ${row.name} (already exists)`);
      continue;
    }

    if (!dryRun) {
      await Subscription.create({
        ...row,
        status: 'Active',
        remindDaysBefore: 7,
      });
    }
    created += 1;
    console.log(`  ${dryRun ? 'would create' : 'created'}  ${row.name}`);
  }

  console.log(`\nDone. created=${created} skipped=${skipped}`);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
