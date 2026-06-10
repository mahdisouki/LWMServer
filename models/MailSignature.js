const mongoose = require('mongoose');

const mailSignatureSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true,
      index: true,
    },
    nameKey: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    profileImageUrl: { type: String, required: true, trim: true },
    signatureHtml: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/** Query helper only — not unique (many signatures per admin). */
mailSignatureSchema.index({ adminId: 1, nameKey: 1 });

const MailSignature = mongoose.model('MailSignature', mailSignatureSchema);

const LEGACY_INDEX_NAMES = [
  'adminId_1_fingerprint_1',
  'fingerprint_1',
  'adminId_1_fingerprint_1_1',
];

/** Drop old Gmail-scan indexes (fingerprint) that block inserts with fingerprint: null. */
async function dropLegacyMailSignatureIndexes() {
  const collection = MailSignature.collection;
  for (const indexName of LEGACY_INDEX_NAMES) {
    try {
      await collection.dropIndex(indexName);
      console.log(`[MailSignature] Dropped legacy index: ${indexName}`);
    } catch {
      /* index may not exist */
    }
  }
  try {
    const indexes = await collection.indexes();
    for (const idx of indexes) {
      const keys = idx.key || {};
      if (Object.prototype.hasOwnProperty.call(keys, 'fingerprint')) {
        await collection.dropIndex(idx.name);
        console.log(`[MailSignature] Dropped legacy index: ${idx.name}`);
      }
    }
  } catch (err) {
    console.warn('[MailSignature] Could not list indexes:', err.message);
  }
  try {
    await MailSignature.updateMany(
      { fingerprint: { $exists: true } },
      { $unset: { fingerprint: 1 } }
    );
  } catch {
    try {
      await collection.updateMany(
        { fingerprint: { $exists: true } },
        { $unset: { fingerprint: '' } }
      );
    } catch {
      /* ignore */
    }
  }
}

MailSignature.dropLegacyIndexes = dropLegacyMailSignatureIndexes;

module.exports = MailSignature;
