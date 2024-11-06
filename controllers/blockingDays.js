const BlockingDays = require('../models/BlockingDays');
const APIfeatures = require('../utils/APIFeatures'); // If you're using a utility for API features

const blockingDaysCtrl = {
    createBlockingDay: async (req, res) => {
        try {
            const { date, type } = req.body;

            const newBlockingDay = new BlockingDays({ date, type });
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
        const { date, type } = req.body;

        try {
            const updatedBlockingDay = await BlockingDays.findByIdAndUpdate(id, { date, type }, { new: true });
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
};

module.exports = blockingDaysCtrl;
