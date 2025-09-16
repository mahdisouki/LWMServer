const BlockingDays = require('../models/BlockingDays');
const APIfeatures = require('../utils/APIFeatures'); // If you're using a utility for API features

const blockingDaysCtrl = {
    createBlockingDay: async (req, res) => {
        try {
            const { date, type, timeSlots } = req.body;

            // Validate that timeSlots is provided and not empty
            if (!timeSlots || timeSlots.length === 0) {
                return res.status(400).json({
                    message: "At least one time slot must be provided in 'timeSlots' array"
                });
            }


            // Validate time slots if provided
            if (timeSlots && Array.isArray(timeSlots)) {
                const validTimeSlots = ['AnyTime', '7am-12pm', '12pm-5pm'];
                const invalidSlots = timeSlots.filter(slot => !validTimeSlots.includes(slot));
                if (invalidSlots.length > 0) {
                    return res.status(400).json({
                        message: "Invalid time slots provided",
                        invalidSlots,
                        validTimeSlots
                    });
                }
            }

            const newBlockingDay = new BlockingDays({ date, type, timeSlots });
            await newBlockingDay.save();
            res.status(201).json({ message: "Blocking day created successfully", blockingDay: newBlockingDay });
        } catch (error) {
            res.status(500).json({ message: "Failed to create blocking day", error: error.message });
        }
    },

    getAllBlockingDays: async (req, res) => {
        try {
            const { page = 1, limit = 9 } = req.query; // Support pagination
            let query = BlockingDays.find();
            const total = await BlockingDays.countDocuments(query);

            const features = new APIfeatures(query, req.query);
            features.sorting().paginating();
            const blockingDays = await features.query.exec();
            const currentPage = parseInt(req.query.page, 10) || 1;
            const limitNum = parseInt(req.query.limit, 10) || 9;

            res.status(200).json({
                message: "All blocking days retrieved successfully",
                blockingDays,
                meta: {
                    currentPage,
                    limit: limitNum,
                    total,
                    count: blockingDays.length,
                },
            });
        } catch (error) {
            res.status(500).json({ message: "Failed to retrieve blocking days", error: error.message });
        }
    },

    getBlockingDayById: async (req, res) => {
        const { id } = req.params;
        try {
            const blockingDay = await BlockingDays.findById(id);
            if (!blockingDay) {
                return res.status(404).json({ message: "Blocking day not found" });
            }
            res.status(200).json(blockingDay);
        } catch (error) {
            res.status(500).json({ message: "Failed to fetch blocking day", error: error.message });
        }
    },

    updateBlockingDay: async (req, res) => {
        const { id } = req.params;
        const { date, type, timeSlots } = req.body;

        try {
            // Validate that timeSlots is provided and not empty
            if (!timeSlots || timeSlots.length === 0) {
                return res.status(400).json({
                    message: "At least one time slot must be provided in 'timeSlots' array"
                });
            }


            // Validate time slots if provided
            if (timeSlots && Array.isArray(timeSlots)) {
                const validTimeSlots = ['AnyTime', '7am-12pm', '12pm-5pm'];
                const invalidSlots = timeSlots.filter(slot => !validTimeSlots.includes(slot));
                if (invalidSlots.length > 0) {
                    return res.status(400).json({
                        message: "Invalid time slots provided",
                        invalidSlots,
                        validTimeSlots
                    });
                }
            }

            const updatedBlockingDay = await BlockingDays.findByIdAndUpdate(id, { date, type, timeSlots }, { new: true });
            if (!updatedBlockingDay) {
                return res.status(404).json({ message: "Blocking day not found" });
            }
            res.status(200).json({ message: "Blocking day updated successfully", blockingDay: updatedBlockingDay });
        } catch (error) {
            res.status(500).json({ message: "Failed to update blocking day", error: error.message });
        }
    },

    deleteBlockingDay: async (req, res) => {
        const { id } = req.params;
        try {
            const blockingDay = await BlockingDays.findByIdAndDelete(id);
            if (!blockingDay) {
                return res.status(404).json({ message: "Blocking day not found" });
            }
            res.status(200).json({ message: "Blocking day deleted successfully" });
        } catch (error) {
            res.status(500).json({ message: "Failed to delete blocking day", error: error.message });
        }
    },

    getAvailableTimeSlots: async (req, res) => {
        try {
            const { date } = req.query;

            if (!date) {
                return res.status(400).json({ message: "Date parameter is required" });
            }

            const queryDate = new Date(date);
            const blockingDay = await BlockingDays.findOne({ date: queryDate });

            const allTimeSlots = ['AnyTime', '7am-12pm', '12pm-5pm'];

            if (!blockingDay || !blockingDay.timeSlots || blockingDay.timeSlots.length === 0) {
                // If no blocking day exists or no time slots are blocked, all slots are available
                return res.status(200).json({
                    message: "Available time slots retrieved successfully",
                    date: queryDate,
                    availableTimeSlots: allTimeSlots,
                    blockedTimeSlots: []
                });
            }

            const availableTimeSlots = allTimeSlots.filter(slot => !blockingDay.timeSlots.includes(slot));

            res.status(200).json({
                message: "Available time slots retrieved successfully",
                date: queryDate,
                availableTimeSlots,
                blockedTimeSlots: blockingDay.timeSlots
            });
        } catch (error) {
            res.status(500).json({ message: "Failed to retrieve available time slots", error: error.message });
        }
    },
};

module.exports = blockingDaysCtrl;
