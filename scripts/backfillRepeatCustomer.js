require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../models/Task');

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
 * For each email with more than one task:
 *   repeatCustomer = (number of tasks with that email) - 1
 * for ALL tasks with that email (case-insensitive match),
 * mirroring the logic used in taskCtrl.createTask.
 */
const backfillRepeatCustomer = async () => {
    try {
        console.log('🚀 Starting repeatCustomer backfill...\n');

        // Group tasks by email and count how many tasks per email
        const groups = await Task.aggregate([
            {
                $match: {
                    email: { $exists: true, $ne: null, $ne: '' },
                },
            },
            {
                $group: {
                    _id: '$email',
                    count: { $sum: 1 },
                },
            },
            {
                $match: {
                    count: { $gt: 1 }, // only emails with repeats
                },
            },
        ]);

        console.log(`📊 Found ${groups.length} email(s) with repeat tasks\n`);

        let totalUpdatedDocs = 0;

        // Helper for safe regex, same approach as in taskCtrl.createTask
        const escapeRegExp = (s) =>
            String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        for (const group of groups) {
            const rawEmail = group._id;
            const count = group.count;
            const repeatCustomerValue = Math.max(0, count - 1);

            const emailNormalized = String(rawEmail).trim().toLowerCase();
            const emailExactCi = new RegExp(
                `^${escapeRegExp(emailNormalized)}$`,
                'i',
            );

            const result = await Task.updateMany(
                { email: emailExactCi },
                { $set: { repeatCustomer: repeatCustomerValue } },
            );

            const modifiedCount = result.modifiedCount || result.nModified || 0;
            totalUpdatedDocs += modifiedCount;

            console.log(
                `✅ Email ${rawEmail} -> count=${count}, repeatCustomer=${repeatCustomerValue}, updated ${modifiedCount} task(s)`,
            );
        }

        console.log('\n✅ Backfill complete');
        console.log(`📊 Total tasks updated: ${totalUpdatedDocs}`);
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


