/**
 * Backfill missing permission module keys on existing Admin users.
 *
 * Admins who already have at least one module permission receive
 * View + Edit + Delete on every module key that is not yet set.
 * Admins with no permissions are left unchanged.
 *
 * Usage (from repo root):
 *   node scripts/backfillAdminPermissionModules.js
 *   node scripts/backfillAdminPermissionModules.js --dry-run
 *
 * Requires MONGODB_URI or MONGO_URI in .env.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const { MODULES, PERMISSION_ACTIONS } = require('../config/permissionModules');

const FULL_ACCESS = [...PERMISSION_ACTIONS];

async function connectDB() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGODB_URI or MONGO_URI must be set in .env');
  }
  await mongoose.connect(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
}

function hasAnyPermission(permissions = {}) {
  return MODULES.some((moduleName) => {
    const actions = permissions[moduleName];
    return Array.isArray(actions) && actions.length > 0;
  });
}

function buildUpdatedPermissions(permissions = {}) {
  const next = { ...permissions };
  let changed = false;

  for (const moduleName of MODULES) {
    const existing = next[moduleName];
    if (Array.isArray(existing) && existing.length > 0) {
      continue;
    }

    next[moduleName] = FULL_ACCESS;
    changed = true;
  }

  return { permissions: next, changed };
}

async function backfillAdminPermissionModules({ dryRun = false } = {}) {
  const admins = await Admin.find({}).select('_id username email permissions').lean();
  let updatedCount = 0;
  let skippedCount = 0;

  console.log(`Found ${admins.length} admin(s).`);

  for (const admin of admins) {
    if (!hasAnyPermission(admin.permissions)) {
      skippedCount += 1;
      console.log(`Skip ${admin.email || admin.username || admin._id}: no existing permissions`);
      continue;
    }

    const { permissions, changed } = buildUpdatedPermissions(admin.permissions || {});
    if (!changed) {
      skippedCount += 1;
      console.log(`Skip ${admin.email || admin.username || admin._id}: already has all module keys`);
      continue;
    }

    updatedCount += 1;
    console.log(`Update ${admin.email || admin.username || admin._id}`);

    if (!dryRun) {
      await Admin.updateOne({ _id: admin._id }, { $set: { permissions } });
    }
  }

  console.log(`Done. Updated: ${updatedCount}, skipped: ${skippedCount}${dryRun ? ' (dry run)' : ''}.`);
  return { updatedCount, skippedCount };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  try {
    await connectDB();
    await backfillAdminPermissionModules({ dryRun });
  } catch (error) {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = { backfillAdminPermissionModules, connectDB };
