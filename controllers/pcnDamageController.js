const DailySheet = require('../models/DailySheet');
const PcnDamage = require('../models/PcnDamage');
const { User } = require('../models/User');
const Truck = require('../models/Truck');
const Payroll = require('../models/Payroll');

const pcnDamageController = {
    // Helper function to recalculate payroll PCN/Damages
    recalculatePayrollPcnDamages: async (date, userId) => {
        try {
            // Ensure date is a Date object
            const targetDate = new Date(date);
            const startDate = new Date(targetDate);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(targetDate);
            endDate.setHours(23, 59, 59, 999);

            // Find payroll records for this user on this date (using startTime to match the day)
            const payrollRecords = await Payroll.find({
                userId: userId,
                startTime: { $gte: startDate, $lte: endDate }
            });

            if (payrollRecords.length === 0) {
                console.log(`No payroll records found for user ${userId} on date ${date}`);
                return; // No payroll records to update
            }

            // Get the daily sheet to find PCN/Damages
            // For helpers, find via truck
            let dailySheet = await DailySheet.findOne({
                driverId: userId,
                date: { $gte: startDate, $lte: endDate }
            });

            // If user is a helper and no daily sheet found, find via truck
            if (!dailySheet) {
                const truck = await Truck.findOne({ helperId: userId });
                if (truck && truck.driverId) {
                    dailySheet = await DailySheet.findOne({
                        driverId: truck.driverId,
                        date: { $gte: startDate, $lte: endDate }
                    });
                }
            }

            // Calculate total PCN/Damages for this user from the new PcnDamage model
            let totalPcnDamages = 0;
            if (dailySheet) {
                const pcnDamages = await PcnDamage.find({
                    dailySheetId: dailySheet._id,
                    deductedFromUserId: userId
                });
                totalPcnDamages = pcnDamages.reduce((sum, pcn) => sum + (pcn.amount || 0), 0);
            }

            // Update all payroll records for this user on this date
            for (const payroll of payrollRecords) {
                payroll.totalPcnDamages = totalPcnDamages;
                await payroll.save();
                console.log(`Updated payroll ${payroll._id} with totalPcnDamages: ${totalPcnDamages}`);
            }
        } catch (error) {
            console.error('Error recalculating payroll PCN/Damages:', error);
            // Don't throw - we don't want to fail the main operation if payroll update fails
        }
    },

    addPcnDamage: async (req, res) => {
        try {
            const { driverId, date } = req.params;
            const { pcnReferenceNumber, reason, amount, deductedFromUserId, addedBy } = req.body;

            if (!reason || !deductedFromUserId) {
                return res.status(400).json({
                    message: 'Reason and deductedFromUserId are required.'
                });
            }

            // Validate that the user exists and is a Driver or Helper
            const user = await User.findById(deductedFromUserId);
            if (!user) {
                return res.status(404).json({
                    message: 'User not found'
                });
            }

            const isDriver = user.role && (user.role.includes('Driver') || user.roleType === 'Driver');
            const isHelper = user.role && (user.role.includes('Helper') || user.roleType === 'Helper');

            if (!isDriver && !isHelper) {
                return res.status(400).json({
                    message: 'deductedFromUserId must be a Driver or Helper'
                });
            }

            // Handle proof: accepts file upload (image/PDF) or URL string
            // req.file.path contains Cloudinary URL for uploaded files (images/PDFs)
            // req.body.proofUrl accepts direct URLs (for images, PDFs, or any other URL)
            const proofUrl = req.file ? req.file.path : (req.body.proofUrl || null);

            const startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);

            // Find the driver's daily sheet
            // If the user is a helper, find their driver via truck
            let targetDriverId = driverId;
            if (isHelper) {
                const truck = await Truck.findOne({ helperId: deductedFromUserId });
                if (!truck || !truck.driverId) {
                    return res.status(404).json({
                        message: 'Helper is not assigned to any truck or truck has no driver. Please assign helper to a truck first.'
                    });
                }
                targetDriverId = truck.driverId;
            } else if (isDriver && deductedFromUserId.toString() !== driverId) {
                // If it's a different driver, use the provided driverId from params
                targetDriverId = driverId;
            }

            const dailySheet = await DailySheet.findOne({
                driverId: targetDriverId,
                date: { $gte: startDate, $lte: endDate },
            });

            if (!dailySheet) {
                return res.status(404).json({
                    message: 'Daily sheet not found for that date. Please generate the daily sheet first.'
                });
            }

            // Create new PcnDamage document
            const pcnDamage = new PcnDamage({
                pcnReferenceNumber,
                dailySheetId: dailySheet._id,
                reason,
                amount,
                deductedFromUserId,
                proofUrl,
                addedBy,
            });

            await pcnDamage.save();

            // Recalculate payroll for the user this PCN/Damage is deducted from
            await pcnDamageController.recalculatePayrollPcnDamages(date, deductedFromUserId);

            res.status(200).json({
                message: 'PCN/Damage added successfully',
                pcnDamage
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                message: 'Failed to add PCN/Damage',
                error: error.message
            });
        }
    },

    updatePcnDamage: async (req, res) => {
        try {
            const { driverId, date, pcnDamageId } = req.params;
            const { pcnReferenceNumber, reason, amount, deductedFromUserId, newDate } = req.body;

            const startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);

            const dailySheet = await DailySheet.findOne({
                driverId,
                date: { $gte: startDate, $lte: endDate },
            });

            if (!dailySheet) {
                return res.status(404).json({ message: 'Daily sheet not found' });
            }

            const pcnDamage = await PcnDamage.findOne({
                _id: pcnDamageId,
                dailySheetId: dailySheet._id
            });

            if (!pcnDamage) {
                return res.status(404).json({ message: 'PCN/Damage not found' });
            }

            // Store old values before update
            const oldDeductedFromUserId = pcnDamage.deductedFromUserId;
            const oldDailySheetId = pcnDamage.dailySheetId;
            const oldDate = date;

            // Handle date update if newDate is provided
            let newDailySheet = dailySheet;
            let dateToUse = date;

            if (newDate) {
                const newStartDate = new Date(newDate);
                newStartDate.setHours(0, 0, 0, 0);
                const newEndDate = new Date(newDate);
                newEndDate.setHours(23, 59, 59, 999);

                // Find the new daily sheet for the new date
                newDailySheet = await DailySheet.findOne({
                    driverId,
                    date: { $gte: newStartDate, $lte: newEndDate },
                });

                if (!newDailySheet) {
                    return res.status(404).json({
                        message: 'Daily sheet not found for the new date. Please generate the daily sheet first.'
                    });
                }

                // Update the dailySheetId
                pcnDamage.dailySheetId = newDailySheet._id;
                dateToUse = newDate;
            }

            // Update other fields
            if (pcnReferenceNumber !== undefined) pcnDamage.pcnReferenceNumber = pcnReferenceNumber;
            if (reason !== undefined) pcnDamage.reason = reason;
            if (amount !== undefined) pcnDamage.amount = amount;
            if (deductedFromUserId !== undefined) {
                // Validate that the user exists and is a Driver or Helper
                const user = await User.findById(deductedFromUserId);
                if (!user) {
                    return res.status(404).json({
                        message: 'User not found'
                    });
                }

                const isDriver = user.role && (user.role.includes('Driver') || user.roleType === 'Driver');
                const isHelper = user.role && (user.role.includes('Helper') || user.roleType === 'Helper');

                if (!isDriver && !isHelper) {
                    return res.status(400).json({
                        message: 'deductedFromUserId must be a Driver or Helper'
                    });
                }
                pcnDamage.deductedFromUserId = deductedFromUserId;
            }
            // Handle proof: accepts file upload (image/PDF) or URL string
            // req.file.path contains Cloudinary URL for uploaded files (images/PDFs)
            // req.body.proofUrl accepts direct URLs (for images, PDFs, or any other URL)
            if (req.file) {
                pcnDamage.proofUrl = req.file.path;
            } else if (req.body.proofUrl !== undefined) {
                pcnDamage.proofUrl = req.body.proofUrl;
            }

            await pcnDamage.save();

            // Recalculate payroll for the current date and user
            await pcnDamageController.recalculatePayrollPcnDamages(dateToUse, pcnDamage.deductedFromUserId);

            // If date changed, recalculate payroll for the old date
            if (newDate && oldDate !== dateToUse) {
                await pcnDamageController.recalculatePayrollPcnDamages(oldDate, pcnDamage.deductedFromUserId);
            }

            // If deductedFromUserId changed, recalculate payroll for the old user on both dates
            if (oldDeductedFromUserId && oldDeductedFromUserId.toString() !== pcnDamage.deductedFromUserId.toString()) {
                await pcnDamageController.recalculatePayrollPcnDamages(dateToUse, oldDeductedFromUserId);
                if (newDate && oldDate !== dateToUse) {
                    await pcnDamageController.recalculatePayrollPcnDamages(oldDate, oldDeductedFromUserId);
                }
            }

            res.status(200).json({ message: 'PCN/Damage updated', pcnDamage });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                message: 'Failed to update PCN/Damage',
                error: error.message
            });
        }
    },

    deletePcnDamage: async (req, res) => {
        try {
            const { driverId, date, pcnDamageId } = req.params;

            const startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);

            const dailySheet = await DailySheet.findOne({
                driverId,
                date: { $gte: startDate, $lte: endDate },
            });

            if (!dailySheet) {
                return res.status(404).json({ message: 'Daily sheet not found' });
            }

            const pcnDamage = await PcnDamage.findOne({
                _id: pcnDamageId,
                dailySheetId: dailySheet._id
            });

            if (!pcnDamage) {
                return res.status(404).json({ message: 'PCN/Damage not found' });
            }

            // Store the deductedFromUserId before deleting
            const deductedFromUserId = pcnDamage.deductedFromUserId;

            await PcnDamage.findByIdAndDelete(pcnDamageId);

            // Recalculate payroll for the user this PCN/Damage was deducted from
            await pcnDamageController.recalculatePayrollPcnDamages(date, deductedFromUserId);

            res.status(200).json({ message: 'PCN/Damage deleted' });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                message: 'Failed to delete PCN/Damage',
                error: error.message
            });
        }
    },

    getPcnDamages: async (req, res) => {
        try {
            const { driverId, date } = req.params;

            const startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);

            const dailySheet = await DailySheet.findOne({
                driverId,
                date: { $gte: startDate, $lte: endDate },
            }).select('_id driverId date');

            if (!dailySheet) {
                return res.status(404).json({
                    message: 'Daily sheet not found for that date'
                });
            }

            // Get all PCN/Damages for this daily sheet
            const pcnDamages = await PcnDamage.find({
                dailySheetId: dailySheet._id
            }).populate({
                path: 'deductedFromUserId',
                select: 'username firstName lastName role roleType'
            }).sort({ time: -1 });

            res.status(200).json({
                message: 'PCN/Damages retrieved',
                pcnDamages,
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                message: 'Failed to fetch PCN/Damages',
                error: error.message
            });
        }
    },

    getAllPcnDamages: async (req, res) => {
        try {
            const pcnDamages = await PcnDamage.find()
                .populate({
                    path: 'dailySheetId',
                    select: 'driverId date',
                    populate: {
                        path: 'driverId',
                        select: 'username firstName lastName'
                    }
                })
                .populate({
                    path: 'deductedFromUserId',
                    select: 'username firstName lastName role roleType'
                })
                .sort({ time: -1 });

            // Format the response to match the previous structure
            const formattedPcnDamages = pcnDamages.map(pcn => ({
                _id: pcn._id,
                pcnReferenceNumber: pcn.pcnReferenceNumber,
                driverId: pcn.dailySheetId?.driverId?._id || pcn.dailySheetId?.driverId,
                date: pcn.dailySheetId?.date,
                reason: pcn.reason,
                amount: pcn.amount,
                deductedFromUserId: pcn.deductedFromUserId?._id || pcn.deductedFromUserId,
                deductedFromUser: pcn.deductedFromUserId ? {
                    _id: pcn.deductedFromUserId._id,
                    username: pcn.deductedFromUserId.username,
                    firstName: pcn.deductedFromUserId.firstName,
                    lastName: pcn.deductedFromUserId.lastName,
                    role: pcn.deductedFromUserId.role,
                    roleType: pcn.deductedFromUserId.roleType
                } : null,
                proofUrl: pcn.proofUrl,
                addedBy: pcn.addedBy,
                time: pcn.time,
            }));

            res.status(200).json({
                message: 'All PCN/Damages retrieved',
                count: formattedPcnDamages.length,
                pcnDamages: formattedPcnDamages,
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                message: 'Failed to fetch PCN/Damages',
                error: error.message
            });
        }
    },
};

module.exports = pcnDamageController;

