const mongoose = require('mongoose');
const Task = require('../models/Task');
const StandardItem = require('../models/StandardItem');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/lwm', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

async function fixRefundTasks() {
    try {
        console.log('Starting to fix refund tasks with missing pricing data...');

        // Find tasks that might have refund issues
        const tasksWithIssues = await Task.find({
            $or: [
                { 'items.standardItemId': null },
                { 'items.price': { $exists: false } },
                { 'items.price': 0 },
                { 'items.price': null }
            ]
        });

        console.log(`Found ${tasksWithIssues.length} tasks with potential pricing issues`);

        let fixedCount = 0;

        for (const task of tasksWithIssues) {
            let hasChanges = false;

            for (let i = 0; i < task.items.length; i++) {
                const item = task.items[i];

                // Fix items with null standardItemId but missing price
                if (!item.standardItemId && (!item.price || item.price <= 0)) {
                    // Set a default price based on object name or use a minimum price
                    const defaultPrice = 25; // Minimum price for custom items
                    task.items[i].price = defaultPrice;
                    hasChanges = true;
                    console.log(`Fixed task ${task.orderNumber}: Item ${i} - Set default price to £${defaultPrice}`);
                }

                // Fix items with invalid quantity
                if (!item.quantity || item.quantity <= 0) {
                    task.items[i].quantity = 1;
                    hasChanges = true;
                    console.log(`Fixed task ${task.orderNumber}: Item ${i} - Set quantity to 1`);
                }

                // Fix items with missing Objectsposition
                if (!item.Objectsposition) {
                    task.items[i].Objectsposition = 'Outside';
                    hasChanges = true;
                    console.log(`Fixed task ${task.orderNumber}: Item ${i} - Set Objectsposition to Outside`);
                }
            }

            if (hasChanges) {
                await task.save();
                fixedCount++;
                console.log(`✅ Fixed task ${task.orderNumber}`);
            }
        }

        console.log(`\n🎉 Migration completed! Fixed ${fixedCount} tasks out of ${tasksWithIssues.length} identified issues.`);

    } catch (error) {
        console.error('Error during migration:', error);
    } finally {
        mongoose.connection.close();
    }
}

// Run the migration if this script is executed directly
if (require.main === module) {
    fixRefundTasks();
}

module.exports = { fixRefundTasks };
