const TippingPlace = require('../models/TippingPlaces');
const loggingService = require('../services/loggingService');

const tippingPlaceController = {
    createTippingPlace: async (req, res) => {
        try {
            // Handle image upload if provided
            if (req.file) {
                req.body.image = req.file.path;
            }

            const newTippingPlace = new TippingPlace(req.body);
            await newTippingPlace.save();

            // Create a log of the tipping place creation
            if (req.user) {
                await loggingService.createLog({
                    userId: req.user._id,
                    username: req.user.username,
                    action: 'CREATE',
                    entityType: 'TIPPING_PLACE',
                    entityId: newTippingPlace._id,
                    changes: {
                        created: newTippingPlace.toObject(),
                    },
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                });
            }

            res.status(201).json({ message: "Tipping place created successfully", tippingPlace: newTippingPlace });
        } catch (error) {
            res.status(500).json({ message: "Failed to create tipping place", error: error.message });
        }
    },

    getAllTippingPlaces: async (req, res) => {
        try {
            const tippingPlaces = await TippingPlace.find();
            res.status(200).json({ message: "All tipping places retrieved successfully", tippingPlaces });
        } catch (error) {
            res.status(500).json({ message: "Failed to retrieve tipping places", error: error.message });
        }
    },

    getTippingPlaceById: async (req, res) => {
        const { id } = req.params;
        try {
            const tippingPlace = await TippingPlace.findById(id);
            if (!tippingPlace) {
                return res.status(404).json({ message: "Tipping place not found" });
            }
            res.status(200).json(tippingPlace);
        } catch (error) {
            res.status(500).json({ message: "Failed to fetch tipping place", error: error.message });
        }
    },

    updateTippingPlace: async (req, res) => {
        const { id } = req.params;
        try {
            const oldTippingPlace = await TippingPlace.findById(id);
            if (!oldTippingPlace) {
                return res.status(404).json({ message: "Tipping place not found" });
            }

            // Handle image upload if provided
            if (req.file) {
                req.body.image = req.file.path;
            }

            const updatedTippingPlace = await TippingPlace.findByIdAndUpdate(id, req.body, { new: true });

            // Create a log of the changes
            if (req.user) {
                await loggingService.createLog({
                    userId: req.user._id,
                    username: req.user.username,
                    action: 'UPDATE',
                    entityType: 'TIPPING_PLACE',
                    entityId: id,
                    changes: {
                        before: oldTippingPlace.toObject(),
                        after: updatedTippingPlace.toObject(),
                    },
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                });
            }

            res.status(200).json({ message: "Tipping place updated successfully", tippingPlace: updatedTippingPlace });
        } catch (error) {
            res.status(500).json({ message: "Failed to update tipping place", error: error.message });
        }
    },

    deleteTippingPlace: async (req, res) => {
        const { id } = req.params;
        try {
            const tippingPlace = await TippingPlace.findById(id);
            if (!tippingPlace) {
                return res.status(404).json({ message: "Tipping place not found" });
            }

            // Create a log of the deletion before actually deleting
            if (req.user) {
                await loggingService.createLog({
                    userId: req.user._id,
                    username: req.user.username,
                    action: 'DELETE',
                    entityType: 'TIPPING_PLACE',
                    entityId: id,
                    changes: {
                        deleted: tippingPlace.toObject(),
                    },
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                });
            }

            await TippingPlace.findByIdAndDelete(id);
            res.status(200).json({ message: "Tipping place deleted successfully" });
        } catch (error) {
            res.status(500).json({ message: "Failed to delete tipping place", error: error.message });
        }
    },
};

module.exports = tippingPlaceController;
