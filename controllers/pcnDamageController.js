const DailySheet = require('../models/DailySheet');
const PcnDamage = require('../models/PcnDamage');
const { User } = require('../models/User');
const Truck = require('../models/Truck');
const Payroll = require('../models/Payroll');
const blueSheetController = require('./blueSheetController');

// Format date to YYYY-MM-DD using local timezone (for payroll date matching)
const toLocalDateStr = (d) => {
    if (!d) return null;
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

const pcnDamageController = {
    // Helper function to recalculate payroll PCN/Damages
    recalculatePayrollPcnDamages: async (date, userId) => {
        try {
            // Parse date - support YYYY-MM-DD, DD/MM/YYYY, ISO
            const parsed = new Date(date);
            if (isNaN(parsed.getTime())) {
                console.error('recalculatePayrollPcnDamages: invalid date', date);
                return;
            }
            const y = parsed.getFullYear();
            const m = parsed.getMonth();
            const d = parsed.getDate();
            const startDate = new Date(y, m, d, 0, 0, 0, 0);
            const endDate = new Date(y, m, d, 23, 59, 59, 999);

            // Find payroll records for this user on this date (startTime within day)
            const payrollRecords = await Payroll.find({
                userId: userId,
                startTime: { $gte: startDate, $lte: endDate }
            });

            if (payrollRecords.length === 0) {
                console.log(`No payroll records found for user ${userId} on date ${date}`);
                return;
            }

            // Query PcnDamage by time (same local-day range) and deductedFromUserId
            const pcnDamages = await PcnDamage.find({
                time: { $gte: startDate, $lte: endDate },
                deductedFromUserId: userId
            });
            const totalPcnDamages = pcnDamages.reduce((sum, pcn) => sum + (pcn.amount || 0), 0);

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
            const { pcnReferenceNumber, reason, amount, deductedFromUserId, addedBy, vanMatricule } = req.body;

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
            let helperTruck = null;
            if (isHelper) {
                helperTruck = await Truck.findOne({ helperId: deductedFromUserId });
                if (!helperTruck || !helperTruck.driverId) {
                    return res.status(404).json({
                        message: 'Helper is not assigned to any truck or truck has no driver. Please assign helper to a truck first.'
                    });
                }
                targetDriverId = helperTruck.driverId;
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

            // If a van matricule has been provided, validate that it matches
            // the truck used on this daily sheet. This aligns the validation
            // with the display logic, which falls back to the daily sheet's truck.
            if (vanMatricule) {
                const sheetTruck = await Truck.findById(dailySheet.truckId).populate('vanId');

                if (!sheetTruck) {
                    return res.status(400).json({
                        message: 'Truck for this daily sheet not found.',
                    });
                }

                const truckMatricule = sheetTruck.vanId ? sheetTruck.vanId.matricule : null;
                if (truckMatricule !== vanMatricule) {
                    return res.status(400).json({
                        message: 'Selected van does not match the van used on this daily sheet.',
                    });
                }
            }

            // Create new PcnDamage document (time = date; link via dailySheet.pcnDamages)
            const pcnDamage = new PcnDamage({
                pcnReferenceNumber,
                time: startDate,
                reason,
                amount,
                deductedFromUserId,
                proofUrl,
                addedBy,
                vanMatricule,
            });

            await pcnDamage.save();

            // Add to daily sheet's pcnDamages array
            dailySheet.pcnDamages = dailySheet.pcnDamages || [];
            dailySheet.pcnDamages.push(pcnDamage._id);
            await dailySheet.save();

            // Recalculate payroll for the user this PCN/Damage is deducted from
            await pcnDamageController.recalculatePayrollPcnDamages(date, deductedFromUserId);
            // Sync BlueSheet pcnDamages and pcnDamage total
            await blueSheetController.syncBlueSheetPcnDamages(dailySheet._id);

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

    // Create PCN without a daily sheet (standalone)
    addPcnDamageStandalone: async (req, res) => {
        try {
            const { date, pcnReferenceNumber, reason, amount, deductedFromUserId, addedBy, vanMatricule } = req.body;

            if (!date || !reason || !deductedFromUserId) {
                return res.status(400).json({
                    message: 'date, reason and deductedFromUserId are required.'
                });
            }

            const user = await User.findById(deductedFromUserId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            const isDriver = user.role && (user.role.includes('Driver') || user.roleType === 'Driver');
            const isHelper = user.role && (user.role.includes('Helper') || user.roleType === 'Helper');
            if (!isDriver && !isHelper) {
                return res.status(400).json({
                    message: 'deductedFromUserId must be a Driver or Helper'
                });
            }

            const proofUrl = req.file ? req.file.path : (req.body.proofUrl || null);

            const dateObj = new Date(date);
            dateObj.setHours(0, 0, 0, 0);

            const pcnDamage = new PcnDamage({
                pcnReferenceNumber,
                time: dateObj,
                reason,
                amount,
                deductedFromUserId,
                proofUrl,
                addedBy,
                vanMatricule,
            });

            await pcnDamage.save();

            await pcnDamageController.recalculatePayrollPcnDamages(date, deductedFromUserId);

            res.status(201).json({
                message: 'PCN/Damage created successfully (standalone)',
                pcnDamage
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                message: 'Failed to create PCN/Damage',
                error: error.message
            });
        }
    },

    // Add an existing PCN to a daily sheet
    addPcnDamageToDailySheet: async (req, res) => {
        try {
            const { dailySheetId, pcnDamageId } = req.body;

            if (!dailySheetId || !pcnDamageId) {
                return res.status(400).json({
                    message: 'dailySheetId and pcnDamageId are required.'
                });
            }

            const dailySheet = await DailySheet.findById(dailySheetId);
            if (!dailySheet) {
                return res.status(404).json({ message: 'Daily sheet not found' });
            }

            const pcnDamage = await PcnDamage.findById(pcnDamageId);
            if (!pcnDamage) {
                return res.status(404).json({ message: 'PCN/Damage not found' });
            }

            dailySheet.pcnDamages = dailySheet.pcnDamages || [];
            if (dailySheet.pcnDamages.some(id => id.toString() === pcnDamageId)) {
                return res.status(400).json({
                    message: 'PCN/Damage is already on this daily sheet'
                });
            }
            dailySheet.pcnDamages.push(pcnDamage._id);
            await dailySheet.save();

            await blueSheetController.syncBlueSheetPcnDamages(dailySheet._id);

            res.status(200).json({
                message: 'PCN/Damage added to daily sheet',
                dailySheet,
                pcnDamage
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                message: 'Failed to add PCN/Damage to daily sheet',
                error: error.message
            });
        }
    },

    updatePcnDamage: async (req, res) => {
        try {
            const { driverId, date, pcnDamageId } = req.params;
            const { pcnReferenceNumber, reason, amount, deductedFromUserId, newDate, vanMatricule } = req.body;

            // Find PCN by ID (works for both sheet-linked and standalone)
            const pcnDamage = await PcnDamage.findById(pcnDamageId);
            if (!pcnDamage) {
                return res.status(404).json({ message: 'PCN/Damage not found' });
            }

            // Store old values before update (use local date for payroll matching)
            const oldDeductedFromUserId = pcnDamage.deductedFromUserId;
            const oldDate = pcnDamage.time ? toLocalDateStr(pcnDamage.time) : date;
            let dateToUse = oldDate;

            // Find sheets that contain this PCN (for BlueSheet sync)
            const sheetsWithPcn = await DailySheet.find({ pcnDamages: pcnDamageId });

            // Handle date update if newDate is provided
            if (newDate) {
                const newStartDate = new Date(newDate);
                newStartDate.setHours(0, 0, 0, 0);
                const newEndDate = new Date(newDate);
                newEndDate.setHours(23, 59, 59, 999);

                // Find the new daily sheet for the new date (driverId from params)
                const newDailySheet = await DailySheet.findOne({
                    driverId,
                    date: { $gte: newStartDate, $lte: newEndDate },
                });

                if (newDailySheet) {
                    // Remove from old sheet(s)
                    for (const sheet of sheetsWithPcn) {
                        sheet.pcnDamages = (sheet.pcnDamages || []).filter(
                            id => id.toString() !== pcnDamageId
                        );
                        await sheet.save();
                        await blueSheetController.syncBlueSheetPcnDamages(sheet._id);
                    }
                    // Add to new sheet
                    newDailySheet.pcnDamages = newDailySheet.pcnDamages || [];
                    if (!newDailySheet.pcnDamages.some(id => id.toString() === pcnDamageId)) {
                        newDailySheet.pcnDamages.push(pcnDamage._id);
                    }
                    await newDailySheet.save();
                    await blueSheetController.syncBlueSheetPcnDamages(newDailySheet._id);
                }

                pcnDamage.time = newStartDate;
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
            if (vanMatricule !== undefined) {
                pcnDamage.vanMatricule = vanMatricule;
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

            // Sync BlueSheet(s) for any DailySheet that contains this PCN (query after update)
            const sheetsContainingPcn = await DailySheet.find({ pcnDamages: pcnDamage._id });
            for (const sheet of sheetsContainingPcn) {
                await blueSheetController.syncBlueSheetPcnDamages(sheet._id);
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
            const { pcnDamageId } = req.params;

            const pcnDamage = await PcnDamage.findById(pcnDamageId);
            if (!pcnDamage) {
                return res.status(404).json({ message: 'PCN/Damage not found' });
            }

            const deductedFromUserId = pcnDamage.deductedFromUserId;
            const pcnDate = pcnDamage.time ? toLocalDateStr(pcnDamage.time) : null;

            // Remove from any DailySheet.pcnDamages
            const sheetsWithPcn = await DailySheet.find({ pcnDamages: pcnDamageId });
            for (const sheet of sheetsWithPcn) {
                sheet.pcnDamages = (sheet.pcnDamages || []).filter(
                    id => id.toString() !== pcnDamageId
                );
                await sheet.save();
            }

            await PcnDamage.findByIdAndDelete(pcnDamageId);

            // Recalculate payroll for the user
            if (pcnDate) {
                await pcnDamageController.recalculatePayrollPcnDamages(pcnDate, deductedFromUserId);
            }
            // Sync BlueSheet for any sheet that had this PCN
            for (const sheet of sheetsWithPcn) {
                await blueSheetController.syncBlueSheetPcnDamages(sheet._id);
            }

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
            })
                .select('_id driverId date pcnDamages')
                .populate({
                    path: 'pcnDamages',
                    populate: {
                        path: 'deductedFromUserId',
                        select: 'username firstName lastName role roleType'
                    },
                    options: { sort: { time: -1 } }
                });

            if (!dailySheet) {
                return res.status(404).json({
                    message: 'Daily sheet not found for that date'
                });
            }

            const pcnDamages = dailySheet.pcnDamages || [];

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
                    select: 'driverId date truckId',
                    populate: [
                        {
                            path: 'driverId',
                            select: 'username firstName lastName'
                        },
                        {
                            path: 'truckId',
                            select: 'vanId',
                            populate: { path: 'vanId', select: 'matricule' }
                        }
                    ]
                })
                .populate({
                    path: 'deductedFromUserId',
                    select: 'username firstName lastName role roleType'
                })
                .sort({ time: -1 });

            // Format the response to match the previous structure,
            // but ensure we always return a vanMatricule:
            // 1) use the value stored on the PCN document if present
            // 2) otherwise fall back to the truck's matricule from the daily sheet
            const formattedPcnDamages = pcnDamages.map(pcn => {
                const driverFromDailySheet = pcn.dailySheetId?.driverId;
                const truckFromDailySheet = pcn.dailySheetId?.truckId;

                const resolvedVanMatricule =
                    pcn.vanMatricule ||
                    (truckFromDailySheet && truckFromDailySheet.vanId && truckFromDailySheet.vanId.matricule) ||
                    null;

                return {
                    _id: pcn._id,
                    pcnReferenceNumber: pcn.pcnReferenceNumber,
                    driverId: driverFromDailySheet?._id || driverFromDailySheet,
                    date: pcn.time || pcn.dailySheetId?.date,
                    reason: pcn.reason,
                    amount: pcn.amount,
                    deductedFromUserId: pcn.deductedFromUserId?._id || pcn.deductedFromUserId,
                    deductedFromUser: pcn.deductedFromUserId
                        ? {
                            _id: pcn.deductedFromUserId._id,
                            username: pcn.deductedFromUserId.username,
                            firstName: pcn.deductedFromUserId.firstName,
                            lastName: pcn.deductedFromUserId.lastName,
                            role: pcn.deductedFromUserId.role,
                            roleType: pcn.deductedFromUserId.roleType
                        }
                        : null,
                    proofUrl: pcn.proofUrl,
                    addedBy: pcn.addedBy,
                    time: pcn.time,
                    vanMatricule: resolvedVanMatricule,
                };
            });

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

