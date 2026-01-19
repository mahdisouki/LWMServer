require('dotenv').config();
const mongoose = require('mongoose');
const PaymentHistory = require('../models/PaymentHistory');

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Migration function to backfill status field
const migratePaymentHistoryStatus = async () => {
  try {
    console.log('🚀 Starting PaymentHistory status migration...\n');

    // Find all PaymentHistory records that don't have status set or have status = 'pending'
    // Also include records where status field doesn't exist (older records)
    const recordsToUpdate = await PaymentHistory.find({
      $or: [
        { status: { $exists: false } },
        { status: null },
        { status: 'pending' }
      ]
    });

    console.log(`📊 Found ${recordsToUpdate.length} PaymentHistory records to update\n`);

    if (recordsToUpdate.length === 0) {
      console.log('✅ No records need updating. All records already have a status.');
      return;
    }

    let updatedCount = 0;
    let skippedCount = 0;

    for (const record of recordsToUpdate) {
      try {
        // If record has a valid transactionId and paymentDate, assume it was successful
        // (Failed payments should have been created with status: 'failed' by webhooks)
        // Check if transactionId is not 'failed' and is a valid Stripe/PayPal ID format
        const validTransactionId = record.transactionId && 
                                   record.transactionId !== 'failed' && 
                                   (record.transactionId.startsWith('ch_') || // Charge ID (best)
                                    record.transactionId.startsWith('pi_') || // Payment Intent ID
                                    record.transactionId.startsWith('cs_') || // Checkout Session ID (fallback)
                                    record.transactionId.startsWith('paypal') || // PayPal ID
                                    /^[0-9A-Z]{17}$/.test(record.transactionId)); // PayPal capture ID format
        
        if (validTransactionId && record.paymentDate) {
          // Note: If transactionId starts with 'cs_', it's a Checkout Session ID (not ideal)
          // but we'll still mark it as success since it has a paymentDate
          const transactionTypeNote = record.transactionId.startsWith('cs_') 
            ? ' (Note: Checkout Session ID - consider updating to Charge ID)' 
            : '';
          
          const statusMessage = `Payment successful via ${record.paymentType}. Transaction ID: ${record.transactionId}. Amount: £${record.amount.toFixed(2)}.${transactionTypeNote}`;
          
          record.status = 'success';
          record.statusMessage = statusMessage;
          
          await record.save();
          updatedCount++;
          
          if (record.transactionId.startsWith('cs_')) {
            console.log(`✅ Updated record ${record._id}: status = 'success' (⚠️ Checkout Session ID detected)`);
          } else {
            console.log(`✅ Updated record ${record._id}: status = 'success'`);
          }
        } else {
          // Keep as pending if transaction looks invalid
          if (!record.status) {
            record.status = 'pending';
            await record.save();
          }
          skippedCount++;
          console.log(`⏭️  Skipped record ${record._id}: invalid or missing transaction data (transactionId: ${record.transactionId})`);
        }
      } catch (error) {
        console.error(`❌ Error updating record ${record._id}:`, error.message);
        skippedCount++;
      }
    }

    console.log(`\n📊 Migration Summary:`);
    console.log(`   ✅ Successfully updated: ${updatedCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`   📧 Total processed: ${recordsToUpdate.length}`);

  } catch (error) {
    console.error('❌ Fatal error in migration:', error);
    throw error;
  }
};

// Run the migration
const run = async () => {
  try {
    await connectDB();
    await migratePaymentHistoryStatus();
    console.log('\n✅ Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
};

// Execute if run directly
if (require.main === module) {
  run();
}

module.exports = { migratePaymentHistoryStatus };
