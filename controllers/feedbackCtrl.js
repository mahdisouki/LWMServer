// controllers/feedbackCtrl.js
const Feedback = require('../models/Feedback');
const APIfeatures = require('../utils/APIFeatures');

const feedbackCtrl = {
    createFeedback: async (req, res) => {
        try {
            const { name, description, rate } = req.body;
            const image = req.file ? req.file.path : null; // Handle image upload via Cloudinary

            // if (!image) {
            //     return res.status(400).json({ message: "Image is required" });
            // }

            if (!rate || rate < 0 || rate > 5) {
                return res.status(400).json({ message: "Rate is required and must be between 0 and 5" });
            }

            const newFeedback = new Feedback({
                name,
                description,
                image,
                rate
            });

            await newFeedback.save();
            res.status(201).json({
                message: "Feedback created successfully",
                feedback: newFeedback
            });
        } catch (error) {
            res.status(500).json({
                message: "Failed to create feedback",
                error: error.message
            });
        }
    },

    getAllFeedbacks: async (req, res) => {
        try {
            const { page = 1, limit = 9, search, minRate, maxRate } = req.query;

            let filters = {};
            if (req.query.filters) {
                try {
                    filters = JSON.parse(req.query.filters);
                } catch (parseError) {
                    return res.status(400).json({
                        message: "Invalid JSON format in filters",
                        error: parseError.message,
                    });
                }
            }

            // Add search logic
            if (search) {
                filters = {
                    ...filters,
                    $or: [
                        { name: { $regex: search, $options: 'i' } },
                        { description: { $regex: search, $options: 'i' } },
                    ],
                };
            }

            // Add rate filters
            if (minRate || maxRate) {
                filters.rate = {};
                if (minRate) filters.rate.$gte = parseFloat(minRate);
                if (maxRate) filters.rate.$lte = parseFloat(maxRate);
            }

            const query = Feedback.find(filters);

            const features = new APIfeatures(query, req.query)
                .sorting()
                .paginating();

            const feedbacks = await features.query.exec();
            const total = await Feedback.countDocuments(filters);

            res.status(200).json({
                message: "All feedbacks retrieved successfully",
                feedbacks,
                meta: {
                    currentPage: parseInt(page, 10),
                    limit: parseInt(limit, 10),
                    total,
                    count: feedbacks.length,
                },
            });

        } catch (error) {
            res.status(500).json({
                message: "Failed to retrieve feedbacks",
                error: error.message
            });
        }
    },

    getFeedbackById: async (req, res) => {
        const { id } = req.params;
        try {
            const feedback = await Feedback.findById(id);
            if (!feedback) {
                return res.status(404).json({ message: "Feedback not found" });
            }
            res.status(200).json({
                message: "Feedback retrieved successfully",
                feedback
            });
        } catch (error) {
            res.status(500).json({
                message: "Failed to fetch feedback",
                error: error.message
            });
        }
    },

    updateFeedback: async (req, res) => {
        const { id } = req.params;
        const { name, description, rate } = req.body;
        const image = req.file ? req.file.path : undefined;

        // Create a dynamic update object
        const updates = {};
        if (name) updates.name = name;
        if (description) updates.description = description;
        if (rate !== undefined) {
            if (rate < 0 || rate > 5) {
                return res.status(400).json({ message: "Rate must be between 0 and 5" });
            }
            updates.rate = rate;
        }
        if (image) updates.image = image;

        try {
            const updatedFeedback = await Feedback.findByIdAndUpdate(
                id,
                updates,
                { new: true }
            );
            if (!updatedFeedback) {
                return res.status(404).json({ message: "Feedback not found" });
            }
            res.status(200).json({
                message: "Feedback updated successfully",
                feedback: updatedFeedback
            });
        } catch (error) {
            res.status(500).json({
                message: "Failed to update feedback",
                error: error.message
            });
        }
    },

    deleteFeedback: async (req, res) => {
        const { id } = req.params;
        try {
            const feedback = await Feedback.findByIdAndDelete(id);
            if (!feedback) {
                return res.status(404).json({ message: "Feedback not found" });
            }
            res.status(200).json({ message: "Feedback deleted successfully" });
        } catch (error) {
            res.status(500).json({
                message: "Failed to delete feedback",
                error: error.message
            });
        }
    }
};

module.exports = feedbackCtrl;
