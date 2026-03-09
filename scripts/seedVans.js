/**
 * Seed vans (trucks) from name/reg matrix.
 * Run: node scripts/seedVans.js
 * Requires: .env with MONGODB_URI or MONGO_URI
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Truck = require('../models/Truck');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI or MONGODB_URI not set in .env');
  process.exit(1);
}

// suffix → reg
const REG_BY_SUFFIX = {
  XHF: 'NK24 XHF',
  DXM: 'FX23 DXM',
  ZPG: 'HV23 ZPG',
  YMC: 'BF23 YMC',
  VUN: 'EA24VUN',
  XHO: 'NK24 XHO',
};

// Driver/team prefixes (6 suffixes each)
const TEAMS = ['ruben+yafet', 'maten+falah', 'NARCIS', 'ZERAK', 'ZICO', 'ASH'];

function buildVans() {
  const vans = [];
  const matriculeCount = {};
  for (const team of TEAMS) {
    for (const suffix of Object.keys(REG_BY_SUFFIX)) {
      const name = team + suffix;
      const baseMatricule = REG_BY_SUFFIX[suffix];
      const count = matriculeCount[baseMatricule] = (matriculeCount[baseMatricule] || 0) + 1;
      const matricule = count === 1 ? baseMatricule : `${baseMatricule} (${count - 1})`;
      const fuelNumber = name.replace(/\+/g, '-').toUpperCase();
      vans.push({ name, matricule, fuelNumber });
    }
  }
  return vans;
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const vans = buildVans();
  let created = 0;
  let skipped = 0;

  for (const v of vans) {
    const existing = await Truck.findOne({ $or: [{ name: v.name }, { fuelNumber: v.fuelNumber }] });
    if (existing) {
      console.log(`  Skip (exists): ${v.name}`);
      skipped++;
      continue;
    }
    await Truck.create({
      name: v.name,
      matricule: v.matricule,
      fuelNumber: v.fuelNumber,
      tasks: new Map(),
    });
    console.log(`  Created: ${v.name} (${v.matricule})`);
    created++;
  }

  console.log(`\n✅ Done. Created: ${created}, Skipped: ${skipped}`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
