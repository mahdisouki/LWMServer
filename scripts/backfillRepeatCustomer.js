require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const { syncRepeatCustomerForEmail } = require('../utils/repeatCustomerSync');

/**
 * Connect to MongoDB using the same env vars as other scripts.
 */
const connectDB = async () => {
    try {
        const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
        if (!MONGO_URI) {
            console.error('❌ MONGO_URI or MONGODB_URI missing in .env');
            process.exit(1);
        }

        await mongoose.connect(MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✅ MongoDB Connected');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        process.exit(1);
    }
};

/**
 * Backfill repeatCustomer for existing tasks.
 *
 * For each distinct email on tasks:
 *   repeatCustomer = max(0, qualifyingCount - 1)
 * where qualifying tasks are those with paymentStatus !== 'Failed',
 * for ALL tasks with that email (case-insensitive match),
 * mirroring utils/repeatCustomerSync / taskCtrl.
 */
const backfillRepeatCustomer = async () => {
    try {
        console.log('🚀 Starting repeatCustomer backfill...\n');

        const emails = await Task.distinct('email', {
            email: { $exists: true, $nin: [null, ''] },
        });

        console.log(`📊 Found ${emails.length} distinct email(s)\n`);

        let processed = 0;
        for (const email of emails) {
            await syncRepeatCustomerForEmail(email);
            processed += 1;
            if (processed % 100 === 0) {
                console.log(`… processed ${processed}/${emails.length} emails`);
            }
        }

        console.log('\n✅ Backfill complete');
        console.log(`📊 Emails processed: ${processed}`);
    } catch (error) {
        console.error('❌ Error during backfill:', error);
        throw error;
    }
};

const run = async () => {
    try {
        await connectDB();
        await backfillRepeatCustomer();
        console.log('\n✅ Script finished successfully');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Script failed:', error);
        process.exit(1);
    }
};

if (require.main === module) {
    run();
}

module.exports = { backfillRepeatCustomer };
