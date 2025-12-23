const cron = require('node-cron');
const Driver = require('../models/Driver');
const Helper = require('../models/Helper');
const Payroll = require('../models/Payroll');
const User = require('../models/User');

/**
 * Automatically ends all active shifts at 10 PM (22:00)
 * This allows drivers and helpers to start a new shift the next day
 * even if they forgot to manually end their shift
 */
async function autoEndShifts() {
    try {
        const now = new Date();
        // Set end time to 10 PM (22:00) of the current day
        const endTime = new Date(now);
        endTime.setHours(22, 0, 0, 0); // 10:00 PM

        console.log(`[Auto End Shifts] Running at ${now.toISOString()}, setting endTime to ${endTime.toISOString()}`);

        // 1. End shifts for Drivers with active shifts (startTime exists but endTime is null)
        const activeDrivers = await Driver.find({
            startTime: { $exists: true, $ne: null },
            endTime: null
        });

        let driversEnded = 0;
        for (const driver of activeDrivers) {
            driver.endTime = endTime;
            await driver.save();
            driversEnded++;
            console.log(`[Auto End Shifts] Ended shift for driver: ${driver.username || driver._id}`);
        }

        // 2. End shifts for Helpers with active shifts (startTime exists but endTime is null)
        const activeHelpers = await Helper.find({
            startTime: { $exists: true, $ne: null },
            endTime: null
        });

        let helpersEnded = 0;
        for (const helper of activeHelpers) {
            helper.endTime = endTime;
            await helper.save();
            helpersEnded++;
            console.log(`[Auto End Shifts] Ended shift for helper: ${helper.username || helper._id}`);
        }

        // 3. End Payroll entries with active shifts (endTime is null)
        const activePayrolls = await Payroll.find({
            endTime: null,
            startTime: { $exists: true, $ne: null }
        });

        let payrollsEnded = 0;
        for (const payroll of activePayrolls) {
            const start = payroll.startTime;
            
            // Only set endTime if startTime exists and is valid
            if (start && endTime > start) {
                payroll.endTime = endTime;
                
                // Calculate total hours worked
                const totalHoursWorked = (endTime - start) / (1000 * 3600); // Convert milliseconds to hours
                payroll.totalHoursWorked = Math.round(totalHoursWorked * 100) / 100; // Round to 2 decimal places
                
                // Get user to check regular hours limit
                const user = await User.findById(payroll.userId);
                if (user && user.regularHours) {
                    const REGULAR_HOURS_LIMIT = user.regularHours;
                    
                    if (totalHoursWorked <= REGULAR_HOURS_LIMIT) {
                        payroll.regularHours = Math.round(totalHoursWorked * 100) / 100;
                        payroll.extraHours = 0;
                    } else {
                        payroll.regularHours = REGULAR_HOURS_LIMIT;
                        payroll.extraHours = Math.round((totalHoursWorked - REGULAR_HOURS_LIMIT) * 100) / 100;
                    }
                } else {
                    // Default to 8 hours if regularHours not set
                    if (totalHoursWorked <= 8) {
                        payroll.regularHours = Math.round(totalHoursWorked * 100) / 100;
                        payroll.extraHours = 0;
                    } else {
                        payroll.regularHours = 8;
                        payroll.extraHours = Math.round((totalHoursWorked - 8) * 100) / 100;
                    }
                }
                
                await payroll.save();
                payrollsEnded++;
                console.log(`[Auto End Shifts] Ended payroll for user: ${payroll.userId}`);
            }
        }

        console.log(`[Auto End Shifts] Completed: ${driversEnded} drivers, ${helpersEnded} helpers, ${payrollsEnded} payrolls ended`);
    } catch (error) {
        console.error('[Auto End Shifts] Error ending shifts:', error);
    }
}

// Schedule the cron job to run every day at 10:00 PM (22:00)
// Cron format: minute hour day month dayOfWeek
// '0 22 * * *' means: at minute 0 of hour 22 (10 PM) every day
cron.schedule('0 22 * * *', autoEndShifts);

console.log('[Auto End Shifts] Scheduler running - will auto-end shifts at 10:00 PM daily');

module.exports = { autoEndShifts };

