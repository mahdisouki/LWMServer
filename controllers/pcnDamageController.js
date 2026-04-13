const DailySheet = require('../models/DailySheet');
const PcnDamage = require('../models/PcnDamage');
const { User } = require('../models/User');
const Truck = require('../models/Truck');
const Van = require('../models/Van');
const UnitAssignmentLogRange = require('../models/UnitAssignmentLogRange');
const Payroll = require('../models/Payroll');
const blueSheetController = require('./blueSheetController');

// Format date to YYYY-MM-DD using local timezone (for payroll date matching)
const toLocalDateStr = (d) => {
    if (!d) return null;
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

// Normalize date-like input into a local-day [start, end] range (ignores time part if present)
const getLocalDayRangeFromInput = (value) => {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    // If input starts with YYYY-MM-DD, use only that date part to avoid time/tz shifts.
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    let baseDate;
    if (match) {
        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1;
        const day = parseInt(match[3], 10);
        baseDate = new Date(year, month, day);
    } else {
        baseDate = new Date(raw);
    }

    if (isNaN(baseDate.getTime())) return null;

    const startDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
    const endDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 23, 59, 59, 999);
    return { startDate, endDate };
};

// Normalize payment status variants into canonical enum values used by the DB.
const normalizePaymentStatus = (value) => {
    if (value === undefined || value === null) return undefined;
    const cleaned = String(value).trim().toLowerCase();
    if (!cleaned) return undefined;
    if (cleaned === 'paid') return 'Paid';
    if (cleaned === 'unpaid' || cleaned === 'unplaid') return 'Unpaid';
    return undefined;
};

/** Trim; empty string becomes undefined so sparse unique index allows multiple PCNs without a ref */
const normalizePcnReferenceNumber = (value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s === '' ? undefined : s;
};

/** Mongo duplicate key on pcnReferenceNumber → 409 with a clear message */
const respondIfDuplicatePcnReference = (error, res) => {
    if (!error || error.code !== 11000) return false;
    const keyPattern = error.keyPattern || {};
    if (!keyPattern.pcnReferenceNumber) return false;
    const conflictingValue = error.keyValue && error.keyValue.pcnReferenceNumber;
    res.status(409).json({
        message:
            'This PCN reference number is already in use. Please use a different reference number, or leave it blank if the PCN does not have one yet.',
        field: 'pcnReferenceNumber',
        ...(conflictingValue != null && conflictingValue !== '' && { conflictingValue: String(conflictingValue) }),
    });
    return true;
};

// Helper: from vanId + dateTime → truckId + driverId using UnitAssignmentLogRange (source of truth)
async function getTruckAndDriverFromVanAtTime(vanId, dateTime) {
    const T = dateTime instanceof Date ? dateTime : new Date(dateTime);
    const result = { truckId: null, driverId: null };

    console.log('[PCN][getTruckAndDriverFromVanAtTime] vanId:', vanId?.toString(), 'at', T.toISOString());

    // 1) Which truck was using this van at time T?
    const vanRange = await UnitAssignmentLogRange.findOne({
        type: 'van',
        refId: vanId,
        startAt: { $lte: T },
        $or: [{ endAt: null }, { endAt: { $gt: T } }],
    })
        .sort({ startAt: -1 })
        .lean();

    console.log('[PCN][getTruckAndDriverFromVanAtTime] vanRange:', vanRange);

    if (!vanRange) {
        console.log('[PCN][getTruckAndDriverFromVanAtTime] No van range found for van at time', T.toISOString());
        return result;
    }

    const truckId = vanRange.truckId;

    // 2) Which driver was on that truck at time T?
    const driverRange = await UnitAssignmentLogRange.findOne({
        truckId,
        type: 'driver',
        startAt: { $lte: T },
        $or: [{ endAt: null }, { endAt: { $gt: T } }],
    })
        .sort({ startAt: -1 })
        .lean();

    console.log('[PCN][getTruckAndDriverFromVanAtTime] driverRange:', driverRange);

    result.truckId = truckId;
    result.driverId = driverRange ? driverRange.refId : null;

    console.log('[PCN][getTruckAndDriverFromVanAtTime] result:', {
        truckId: result.truckId?.toString() || null,
        driverId: result.driverId?.toString() || null,
    });

    return result;
}

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

            // Query PcnDamage by creation date (same local-day range) and deductedFromUserId
            const pcnDamages = await PcnDamage.find({
                createdAt: { $gte: startDate, $lte: endDate },
                deductedFromUserId: userId
            }).select('_id amount');
            const totalPcnDamages = pcnDamages.reduce((sum, pcn) => sum + (pcn.amount || 0), 0);
            const pcnDamageIds = pcnDamages.map((pcn) => pcn._id);

            // Update all payroll records for this user on this date
            for (const payroll of payrollRecords) {
                payroll.totalPcnDamages = totalPcnDamages;
                payroll.pcnDamages = pcnDamageIds;
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
            const { date, pcnReferenceNumber, reason, amount, deductedFromUserId, addedBy, vanMatricule, time, paymentStatus } = req.body;
            const ref = normalizePcnReferenceNumber(pcnReferenceNumber);

            // Validate required fields
            if (!reason || !deductedFromUserId) {
                return res.status(400).json({
                    message: 'Reason and deductedFromUserId are required.'
                });
            }

            // Require date, vanMatricule and time to determine driver from unitAssignment
            if (!date || !vanMatricule || !time) {
                return res.status(400).json({
                    message: 'date, vanMatricule and time are required to determine the driver from unit assignment.'
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

            // Find Van by matricule
            const van = await Van.findOne({ matricule: vanMatricule });
            if (!van) {
                return res.status(404).json({
                    message: `Van with matricule "${vanMatricule}" not found.`
                });
            }

            // Combine date and time to create the exact datetime
            // Support both "HH:mm" and "HH:mm:ss" formats
            const timeStr = time.length === 5 ? `${time}:00` : time; // Add seconds if missing
            const dateTime = new Date(`${date}T${timeStr}`);
            if (isNaN(dateTime.getTime())) {
                return res.status(400).json({
                    message: 'Invalid date or time format. Use YYYY-MM-DD for date and HH:mm or HH:mm:ss for time.'
                });
            }

            // Get truck and driver assignment at the specific date/time using UnitAssignmentLogRange
            const { truckId, driverId: targetDriverId } = await getTruckAndDriverFromVanAtTime(van._id, dateTime);
            if (!truckId || !targetDriverId) {
                return res.status(404).json({
                    message: `No driver was assigned to van "${vanMatricule}" at ${dateTime.toISOString()}.`
                });
            }

            // Create new PcnDamage document with exact dateTime from unitAssignment
            const pcnDamage = new PcnDamage({
                ...(ref !== undefined && { pcnReferenceNumber: ref }),
                time: dateTime, // Use exact dateTime from unitAssignment
                reason,
                amount,
                deductedFromUserId,
                paymentStatus,
                proofUrl,
                addedBy,
                vanMatricule,
            });

            await pcnDamage.save();

            // Try to find DailySheet for PCN creation date - if it exists, link PCN to it
            const sheetDate = pcnDamage.createdAt || new Date();
            const startDate = new Date(sheetDate);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(sheetDate);
            endDate.setHours(23, 59, 59, 999);

            const dailySheet = await DailySheet.findOne({
                driverId: targetDriverId,
                date: { $gte: startDate, $lte: endDate },
            });

            let linkedToDailySheet = false;
            if (dailySheet) {
                dailySheet.pcnDamages = dailySheet.pcnDamages || [];
                dailySheet.pcnDamages.push(pcnDamage._id);
                await dailySheet.save();

                pcnDamage.linkedToDailySheet = true;
                await pcnDamage.save();

                await blueSheetController.syncBlueSheetPcnDamages(dailySheet._id);
                linkedToDailySheet = true;
            }

            const payrollDate = pcnDamage.createdAt ? toLocalDateStr(pcnDamage.createdAt) : date;
            await pcnDamageController.recalculatePayrollPcnDamages(payrollDate, deductedFromUserId);

            res.status(200).json({
                message: linkedToDailySheet
                    ? 'PCN/Damage added successfully and linked to DailySheet'
                    : 'PCN/Damage added successfully (standalone - use /add-to-sheet to link when DailySheet is generated)',
                pcnDamage,
                driverId: targetDriverId, // Return the driver ID found from unitAssignment
                linkedToDailySheet,
            });
        } catch (error) {
            console.error(error);
            if (respondIfDuplicatePcnReference(error, res)) return;
            res.status(500).json({
                message: 'Failed to add PCN/Damage',
                error: error.message
            });
        }
    },

    // Get driver assigned to a van at a specific date/time
    getDriverFromVanAndTime: async (req, res) => {
        try {
            const { vanMatricule, date, time } = req.query;

            if (!vanMatricule || !date || !time) {
                return res.status(400).json({
                    message: 'vanMatricule, date, and time are required as query parameters.'
                });
            }

            // Find Van by matricule
            const van = await Van.findOne({ matricule: vanMatricule });
            if (!van) {
                return res.status(404).json({
                    message: `Van with matricule "${vanMatricule}" not found.`
                });
            }

            // Combine date and time to create the exact datetime
            const timeStr = time.length === 5 ? `${time}:00` : time;
            const dateTime = new Date(`${date}T${timeStr}`);
            if (isNaN(dateTime.getTime())) {
                return res.status(400).json({
                    message: 'Invalid date or time format. Use YYYY-MM-DD for date and HH:mm or HH:mm:ss for time.'
                });
            }

            // Get truck and driver assignment at the specific date/time using UnitAssignmentLogRange
            const { truckId, driverId } = await getTruckAndDriverFromVanAtTime(van._id, dateTime);

            console.log('[PCN][getDriverFromVanAndTime] vanMatricule:', vanMatricule, 'dateTime:', dateTime.toISOString(), {
                truckId: truckId?.toString() || null,
                driverId: driverId?.toString() || null,
            });

            if (!truckId || !driverId) {
                return res.status(404).json({
                    message: `No driver was assigned to van "${vanMatricule}" at ${dateTime.toISOString()}.`,
                    vanMatricule,
                    date,
                    time,
                    dateTime: dateTime.toISOString(),
                    truckId: truckId,
                });
            }

            // Populate driver details
            const driver = await User.findById(driverId).select('firstName lastName username role roleType');

            res.status(200).json({
                message: 'Driver found successfully',
                driver: {
                    _id: driverId,
                    firstName: driver?.firstName,
                    lastName: driver?.lastName,
                    username: driver?.username,
                    role: driver?.role,
                    roleType: driver?.roleType
                },
                vanMatricule,
                date,
                time,
                dateTime: dateTime.toISOString(),
                truckId
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                message: 'Failed to get driver',
                error: error.message
            });
        }
    },

    // Create PCN without a daily sheet (standalone)
    addPcnDamageStandalone: async (req, res) => {
        try {
            const { date, time, vanMatricule, pcnReferenceNumber, reason, amount, deductedFromUserId, addedBy, paymentStatus } = req.body;
            const ref = normalizePcnReferenceNumber(pcnReferenceNumber);

            if (!date || !reason || !deductedFromUserId) {
                return res.status(400).json({
                    message: 'date, reason and deductedFromUserId are required.'
                });
            }

            // NEW: Validate required fields for unitAssignment lookup
            if (!vanMatricule || !time) {
                return res.status(400).json({
                    message: 'vanMatricule and time are required to determine the driver from unit assignment.'
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

            // NEW: Find Van by matricule
            const van = await Van.findOne({ matricule: vanMatricule });
            if (!van) {
                return res.status(404).json({
                    message: `Van with matricule "${vanMatricule}" not found.`
                });
            }

            // NEW: Combine date and time to create the exact datetime
            // Support both "HH:mm" and "HH:mm:ss" formats
            const timeStr = time.length === 5 ? `${time}:00` : time; // Add seconds if missing
            const dateTime = new Date(`${date}T${timeStr}`);
            if (isNaN(dateTime.getTime())) {
                return res.status(400).json({
                    message: 'Invalid date or time format. Use YYYY-MM-DD for date and HH:mm or HH:mm:ss for time.'
                });
            }

            // NEW: Get truck and driver assignment at the specific date/time using UnitAssignmentLogRange
            const { truckId, driverId } = await getTruckAndDriverFromVanAtTime(van._id, dateTime);
            if (!truckId || !driverId) {
                return res.status(404).json({
                    message: `No driver was assigned to van "${vanMatricule}" at ${dateTime.toISOString()}.`
                });
            }

            const pcnDamage = new PcnDamage({
                ...(ref !== undefined && { pcnReferenceNumber: ref }),
                time: dateTime, // Use the exact dateTime
                reason,
                amount,
                deductedFromUserId,
                paymentStatus,
                proofUrl,
                addedBy,
                vanMatricule,
            });

            await pcnDamage.save();

            // Recalculate payroll by PCN creation date (createdAt), not offense date
            const payrollDate = pcnDamage.createdAt ? toLocalDateStr(pcnDamage.createdAt) : date;
            await pcnDamageController.recalculatePayrollPcnDamages(payrollDate, deductedFromUserId);

            // Try to find DailySheet for PCN creation date - if it exists, link PCN to it
            const sheetDate = pcnDamage.createdAt || new Date();
            const startDate = new Date(sheetDate);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(sheetDate);
            endDate.setHours(23, 59, 59, 999);

            const dailySheet = await DailySheet.findOne({
                driverId,
                date: { $gte: startDate, $lte: endDate },
            });

            let linkedToDailySheet = false;
            if (dailySheet) {
                dailySheet.pcnDamages = dailySheet.pcnDamages || [];
                if (!dailySheet.pcnDamages.some(id => id.toString() === pcnDamage._id.toString())) {
                    dailySheet.pcnDamages.push(pcnDamage._id);
                    await dailySheet.save();
                }
                pcnDamage.linkedToDailySheet = true;
                await pcnDamage.save();
                await blueSheetController.syncBlueSheetPcnDamages(dailySheet._id);
                linkedToDailySheet = true;
            }

            res.status(201).json({
                message: 'PCN/Damage created successfully (standalone)',
                pcnDamage,
                driverId, // Return the driver ID found from UnitAssignmentLogRange
                linkedToDailySheet,
            });
        } catch (error) {
            console.error(error);
            if (respondIfDuplicatePcnReference(error, res)) return;
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

            // Update PCN's linkedToDailySheet field in database
            pcnDamage.linkedToDailySheet = true;
            await pcnDamage.save();

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
            const { pcnReferenceNumber, reason, amount, deductedFromUserId, newDate, vanMatricule, paymentStatus } = req.body;

            // Find PCN by ID (works for both sheet-linked and standalone)
            const pcnDamage = await PcnDamage.findById(pcnDamageId);
            if (!pcnDamage) {
                return res.status(404).json({ message: 'PCN/Damage not found' });
            }

            // Store old values before update (use local creation date for payroll matching)
            const oldDeductedFromUserId = pcnDamage.deductedFromUserId;
            const oldDate = pcnDamage.createdAt ? toLocalDateStr(pcnDamage.createdAt) : date;
            let dateToUse = oldDate;

            // Handle offense date update if newDate is provided (DailySheet linking remains based on createdAt)
            if (newDate) {
                const newStartDate = new Date(newDate);
                pcnDamage.time = newStartDate;
                // Payroll deduction day is based on PCN createdAt, not offense date.
                // Keep payroll recalculation date anchored to creation date.
                dateToUse = oldDate;
            }

            // Update other fields (clear ref when empty string / whitespace)
            if (pcnReferenceNumber !== undefined) {
                const nextRef = normalizePcnReferenceNumber(pcnReferenceNumber);
                pcnDamage.pcnReferenceNumber = nextRef;
            }
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
            if (paymentStatus !== undefined) {
                pcnDamage.paymentStatus = paymentStatus;
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

            // Ensure linkedToDailySheet is accurate (in case date didn't change but we need to verify)
            if (!newDate) {
                // If date didn't change, just verify the current link status
                const isLinked = sheetsContainingPcn.length > 0;
                pcnDamage.linkedToDailySheet = isLinked;
                await pcnDamage.save();
            }

            res.status(200).json({ message: 'PCN/Damage updated', pcnDamage });
        } catch (error) {
            console.error(error);
            if (respondIfDuplicatePcnReference(error, res)) return;
            res.status(500).json({
                message: 'Failed to update PCN/Damage',
                error: error.message
            });
        }
    },

    updatePcnPaymentStatus: async (req, res) => {
        try {
            const { pcnDamageId } = req.params;
            const { paymentStatus } = req.body;

            const normalizedPaymentStatus = normalizePaymentStatus(paymentStatus);

            if (!paymentStatus) {
                return res.status(400).json({
                    message: 'paymentStatus is required'
                });
            }

            if (!normalizedPaymentStatus) {
                return res.status(400).json({
                    message: "paymentStatus must be one of: paid, unpaid (or common misspelling: unplaid)"
                });
            }

            const pcnDamage = await PcnDamage.findById(pcnDamageId);
            if (!pcnDamage) {
                return res.status(404).json({ message: 'PCN/Damage not found' });
            }

            pcnDamage.paymentStatus = normalizedPaymentStatus;
            await pcnDamage.save();

            res.status(200).json({
                message: 'PCN payment status updated',
                pcnDamage
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                message: 'Failed to update PCN payment status',
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
            const pcnDate = pcnDamage.createdAt ? toLocalDateStr(pcnDamage.createdAt) : null;

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
            const { date, creationDate, driverId, linkedToDailySheet, paymentStatus, pcnReferenceNumber, page = 1, limit = 10 } = req.query;

            // Build query filters
            const query = {};

            // Filter by date (if provided)
            if (date) {
                const dayRange = getLocalDayRangeFromInput(date);
                if (!dayRange) {
                    return res.status(400).json({
                        message: 'Invalid date format. Use YYYY-MM-DD or any valid date string.'
                    });
                }
                query.time = { $gte: dayRange.startDate, $lte: dayRange.endDate };
            }

            // Filter by creation date (if provided)
            if (creationDate) {
                const creationDayRange = getLocalDayRangeFromInput(creationDate);
                if (!creationDayRange) {
                    return res.status(400).json({
                        message: 'Invalid creationDate format. Use YYYY-MM-DD or any valid date string.'
                    });
                }
                query.createdAt = { $gte: creationDayRange.startDate, $lte: creationDayRange.endDate };
            }

            // Filter by linkedToDailySheet (if provided) - use stored field from database
            if (linkedToDailySheet !== undefined) {
                const isLinked = linkedToDailySheet === 'true' || linkedToDailySheet === true;
                query.linkedToDailySheet = isLinked;
            }

            // Filter by paymentStatus (if provided)
            if (paymentStatus !== undefined) {
                const normalizedPaymentStatus = normalizePaymentStatus(paymentStatus);
                if (!normalizedPaymentStatus) {
                    return res.status(400).json({
                        message: "Invalid paymentStatus. Use paid or unpaid (also accepts unplaid)."
                    });
                }
                query.paymentStatus = normalizedPaymentStatus;
            }

            // Filter by PCN reference number (exact match, trimmed)
            const refFilter = normalizePcnReferenceNumber(pcnReferenceNumber);
            if (refFilter !== undefined) {
                query.pcnReferenceNumber = refFilter;
            }

            // Filter by driver (stored directly on PCN as deductedFromUserId)
            if (driverId) {
                query.deductedFromUserId = driverId;
            }

            // Get all PCN/Damages with filters
            let pcnDamages = await PcnDamage.find(query)
                .populate({
                    path: 'deductedFromUserId',
                    select: 'username firstName lastName role roleType'
                })
                .sort({ createdAt: -1 });

            // Pagination
            const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
            const parsedLimit = Math.max(parseInt(limit, 10) || 10, 1);
            const totalItems = pcnDamages.length;
            const totalPages = Math.max(Math.ceil(totalItems / parsedLimit), 1);
            const startIndex = (parsedPage - 1) * parsedLimit;
            const endIndex = startIndex + parsedLimit;
            const paginatedPcnDamages = pcnDamages.slice(startIndex, endIndex);

            // Use stored linkedToDailySheet field from database (already filtered at query level)
            const pcnDamagesWithLinkStatus = paginatedPcnDamages.map((pcn) => {
                return {
                    ...pcn.toObject(),
                    linkedToDailySheet: pcn.linkedToDailySheet || false // Use stored value from database
                };
            });

            res.status(200).json({
                message: 'PCN/Damages retrieved',
                count: pcnDamagesWithLinkStatus.length,
                totalItems,
                pagination: {
                    page: parsedPage,
                    limit: parsedLimit,
                    totalPages,
                    hasNextPage: parsedPage < totalPages,
                    hasPrevPage: parsedPage > 1
                },
                filters: {
                    date: date || null,
                    creationDate: creationDate || null,
                    driverId: driverId || null,
                    linkedToDailySheet: linkedToDailySheet !== undefined ? (linkedToDailySheet === 'true' || linkedToDailySheet === true) : null,
                    paymentStatus: paymentStatus || null,
                    pcnReferenceNumber: refFilter ?? null
                },
                pcnDamages: pcnDamagesWithLinkStatus,
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

