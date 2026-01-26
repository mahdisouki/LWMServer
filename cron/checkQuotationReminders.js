const cron = require('node-cron');
const QuotationRequest = require('../models/QuotationRequest');
const Task = require('../models/Task');
const { emitNotificationToUser } = require('../socket');
const { User } = require('../models/User');

async function checkQuotationReminders() {
    try {
        const now = new Date();
        console.log(`[Quotation Reminders] Checking at ${now.toISOString()}`);

        // Find quotations where reminderDate has passed and hasn't been sent yet
        // We check for reminders up to 24 hours in the past to catch any missed ones
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const quotationsToRemind = await QuotationRequest.find({
            reminderDate: {
                $lte: now,  // Reminder time has passed
                $gte: oneDayAgo,  // But not older than 24 hours (to avoid processing very old reminders)
                $ne: null  // Ensure reminderDate is not null
            },
            reminderSent: false
        });

        console.log(`[Quotation Reminders] Found ${quotationsToRemind.length} quotations with reminder dates that need checking`);

        if (quotationsToRemind.length === 0) {
            return; // No reminders to process
        }

        // Get all quotation IDs to check their status
        const quotationIds = quotationsToRemind.map(q => q._id);
        const tasksWithQuotations = await Task.find({
            quotationId: { $in: quotationIds }
        }).select('quotationId');

        const quotationsWithOrders = new Set(
            tasksWithQuotations.map(t => t.quotationId.toString())
        );

        // Filter to only pending quotations (no order, no reason)
        const pendingQuotations = quotationsToRemind.filter(quotation => {
            const quotationIdStr = quotation._id.toString();
            const hasOrder = quotationsWithOrders.has(quotationIdStr);
            const hasReason = quotation.reason && quotation.reason.trim() !== '';
            const isPending = !hasOrder && !hasReason;

            if (!isPending) {
                console.log(`[Quotation Reminders] Skipping quotation ${quotationIdStr} - hasOrder: ${hasOrder}, hasReason: ${hasReason}`);
            }

            return isPending;
        });

        console.log(`[Quotation Reminders] Found ${pendingQuotations.length} pending quotations to remind`);

        if (pendingQuotations.length === 0) {
            return; // No pending quotations to remind
        }

        // Send notifications to all admins
        const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
        console.log(`[Quotation Reminders] Found ${adminUsers.length} admin users to notify`);

        for (const quotation of pendingQuotations) {
            // Format reminder date with time
            const reminderDateFormatted = quotation.reminderDate
                ? new Date(quotation.reminderDate).toLocaleString('en-GB', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                })
                : 'N/A';

            // Format creation date
            const createdDateFormatted = quotation.createdAt.toLocaleDateString('en-GB');

            const notificationMessage = `Reminder: Quotation from ${quotation.Name} (${quotation.email}) needs to be chased - pending since ${createdDateFormatted}. Reminder set for: ${reminderDateFormatted}`;

            console.log(`[Quotation Reminders] Sending notification for quotation ${quotation._id} - ${quotation.Name}`);

            for (const admin of adminUsers) {
                try {
                    await emitNotificationToUser(
                        admin._id.toString(),
                        'Quotations',
                        notificationMessage,
                        quotation.Name
                    );
                    console.log(`[Quotation Reminders] Notification sent to admin ${admin._id}`);
                } catch (notifError) {
                    console.error(`[Quotation Reminders] Error sending notification to admin ${admin._id}:`, notifError);
                }
            }

            // Mark reminder as sent
            try {
                quotation.reminderSent = true;
                await quotation.save();
                console.log(`[Quotation Reminders] Marked reminder as sent for quotation ${quotation._id}`);
            } catch (saveError) {
                console.error(`[Quotation Reminders] Error marking reminder as sent for quotation ${quotation._id}:`, saveError);
            }
        }

        console.log(`[Quotation Reminders] ✅ Successfully sent ${pendingQuotations.length} reminder notifications at ${now.toLocaleString()}`);
    } catch (error) {
        console.error('Error in checkQuotationReminders:', error);
    }
}

// Run every 5 minutes to check for reminders
cron.schedule('*/5 * * * *', checkQuotationReminders);

console.log('Quotation reminder scheduler running (checks every 5 minutes)...');

module.exports = { checkQuotationReminders };

