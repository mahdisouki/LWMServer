/**
 * Backfill repeatCustomer for ALL MigrationScript orders, and for any live
 * tasks that share the same customer email.
 *
 * Covers two migrated batches:
 * 1) Older imports — real customer email already on task.email
 * 2) Newer Woo imports — placeholder on task.email, real address in:
 *      privateNotes: "Original Woo email: customer@example.com"
 *
 * The Woo placeholder (soukimahdi@gmail.com) is ignored when collecting from
 * the email field so it is not treated as one giant customer group.
 *
 * For each distinct customer email, calls syncRepeatCustomerForEmail so:
 *   - count includes live tasks (email field) + Woo MigrationScript peers
 *   - repeatCustomer is written on BOTH live and migrated peers
 *
 * Usage (from repo root):
 *   node scripts/backfillMigrationRepeatCustomer.js --dry-run
 *   node scripts/backfillMigrationRepeatCustomer.js
 *
 * Requires MONGODB_URI or MONGO_URI in .env.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const {
  syncRepeatCustomerForEmail,
  peerFilterForEmail,
  wooEmailInNotesRe,
} = require('../utils/repeatCustomerSync');

const dryRun = process.argv.includes('--dry-run');

/** Placeholder used by migrateWooOrders.js — not a real customer. */
const WOO_PLACEHOLDER_EMAIL = 'soukimahdi@gmail.com';

const WOO_EMAIL_RE = /Original Woo email:\s*([^\s<>]+@[^\s<>]+)/i;

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractWooEmail(privateNotes) {
  if (!privateNotes || typeof privateNotes !== 'string') return null;
  const match = privateNotes.match(WOO_EMAIL_RE);
  if (!match) return null;
  return String(match[1]).trim().toLowerCase();
}

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return null;
  if (normalized === WOO_PLACEHOLDER_EMAIL) return null;
  return normalized;
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

async function connectDB() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGODB_URI or MONGO_URI must be set in .env');
  }
  await mongoose.connect(uri);
  console.log('[DB] Connected to MongoDB');
}

async function collectEmailsFromPrivateNotes() {
  const tasks = await Task.find({
    createdBy: 'MigrationScript',
    privateNotes: { $regex: /Original Woo email:/i },
  })
    .select('orderNumber privateNotes')
    .lean();

  const emails = new Set();
  let skipped = 0;

  for (const task of tasks) {
    const email = extractWooEmail(task.privateNotes);
    if (!email) {
      skipped += 1;
      console.warn(
        `[Skip] Order ${task.orderNumber || task._id}: privateNotes has "Original Woo email:" but email could not be parsed`,
      );
      continue;
    }
    emails.add(email);
  }

  return { emails, taskCount: tasks.length, skipped };
}

async function collectEmailsFromEmailField() {
  const rawEmails = await Task.distinct('email', {
    createdBy: 'MigrationScript',
    email: {
      $exists: true,
      $nin: [null, '', WOO_PLACEHOLDER_EMAIL],
    },
  });

  const emails = new Set();
  for (const raw of rawEmails) {
    const email = normalizeEmail(raw);
    if (email) emails.add(email);
  }

  return emails;
}

async function previewEmail(email) {
  const peerFilter = peerFilterForEmail(email);
  const emailExactCi = new RegExp(`^${escapeRegExp(email)}$`, 'i');

  const [qualifyingCount, matchedByEmail, matchedByWooNotes] = await Promise.all([
    Task.countDocuments({
      ...peerFilter,
      paymentStatus: { $ne: 'Failed' },
    }),
    Task.countDocuments({ email: emailExactCi }),
    Task.countDocuments({
      createdBy: 'MigrationScript',
      privateNotes: wooEmailInNotesRe(email),
    }),
  ]);

  const repeatCustomer =
    qualifyingCount > 1 ? Math.max(0, qualifyingCount - 1) : 0;

  return { qualifyingCount, repeatCustomer, matchedByEmail, matchedByWooNotes };
}

function formatEmailLine(index, total, email, info, mode) {
  const prefix = mode === 'dry-run' ? 'WOULD SET' : 'SET';
  return (
    `[${index}/${total}] ${email}\n` +
    `         peers on email field: ${info.matchedByEmail}  |  peers in Woo privateNotes: ${info.matchedByWooNotes}\n` +
    `         non-Failed orders counted: ${info.qualifyingCount}  →  ${prefix} repeatCustomer = ${info.repeatCustomer}` +
    (info.modifiedCount != null ? `  (DB rows updated: ${info.modifiedCount})` : '')
  );
}

async function backfillMigrationRepeatCustomer() {
  logSection(
    dryRun
      ? 'MigrationScript repeatCustomer backfill (DRY RUN — no writes)'
      : 'MigrationScript repeatCustomer backfill (LIVE — will write)',
  );

  console.log(
    `\n[Info] Woo placeholder email (ignored as customer): ${WOO_PLACEHOLDER_EMAIL}`,
  );
  console.log('[Info] task.email on Woo orders is never changed — only repeatCustomer is updated.\n');

  logSection('1) Collect customer emails from migrated orders');

  const fromNotes = await collectEmailsFromPrivateNotes();
  const fromEmailField = await collectEmailsFromEmailField();
  const emails = [...new Set([...fromNotes.emails, ...fromEmailField])].sort();

  console.log('\n[Batch A] Older MigrationScript — real email on task.email');
  console.log(`         Distinct emails found: ${fromEmailField.size}`);
  console.log('         (placeholder soukimahdi@gmail.com excluded)');

  console.log('\n[Batch B] Newer Woo MigrationScript — email in privateNotes');
  console.log(`         Tasks with "Original Woo email:": ${fromNotes.taskCount}`);
  console.log(`         Distinct emails parsed: ${fromNotes.emails.size}`);
  if (fromNotes.skipped) {
    console.log(`         Skipped (unparseable notes): ${fromNotes.skipped}`);
  }

  console.log('\n[Combined] Unique customer emails to process:', emails.length);

  logSection(
    dryRun
      ? '2) Preview what repeatCustomer would be (no DB writes)'
      : '2) Sync repeatCustomer for each email',
  );

  let processed = 0;
  let withRepeats = 0;
  let firstTimers = 0;

  for (const email of emails) {
    processed += 1;

    if (dryRun) {
      const info = await previewEmail(email);
      if (info.repeatCustomer > 0) withRepeats += 1;
      else firstTimers += 1;
      console.log(formatEmailLine(processed, emails.length, email, info, 'dry-run'));
    } else {
      const summary = await syncRepeatCustomerForEmail(email, { silent: true });
      if (!summary) {
        console.warn(`[${processed}/${emails.length}] ${email} — sync failed (see error above)`);
        continue;
      }
      if (summary.repeatCustomer > 0) withRepeats += 1;
      else firstTimers += 1;
      console.log(formatEmailLine(processed, emails.length, email, summary, 'live'));
    }

    if (processed % 50 === 0) {
      console.log(`\n--- progress: ${processed}/${emails.length} emails ---\n`);
    }
  }

  logSection('3) Summary');
  console.log(`Mode:                          ${dryRun ? 'DRY RUN (nothing written)' : 'LIVE (DB updated)'}`);
  console.log(`Customer emails processed:     ${processed}`);
  console.log(`  → first-time (repeatCustomer=0): ${firstTimers}`);
  console.log(`  → repeats   (repeatCustomer>0):  ${withRepeats}`);
  console.log('Woo task.email left as placeholder: yes (unchanged)');
}

async function run() {
  try {
    await connectDB();
    await backfillMigrationRepeatCustomer();
    await mongoose.disconnect();
    console.log('\n[Done] Script finished successfully\n');
    process.exit(0);
  } catch (error) {
    console.error('\n[Failed] Script error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { backfillMigrationRepeatCustomer, extractWooEmail };
