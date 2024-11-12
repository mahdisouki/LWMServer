const TippingPlace = require('../models/TippingPlaces');

const tippingPlaceController = {
    createTippingPlace: async (req, res) => {
        try {
            const newTippingPlace = new TippingPlace(req.body);
            await newTippingPlace.save();
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
            const updatedTippingPlace = await TippingPlace.findByIdAndUpdate(id, req.body, { new: true });
            if (!updatedTippingPlace) {
                return res.status(404).json({ message: "Tipping place not found" });
            }
            res.status(200).json({ message: "Tipping place updated successfully", tippingPlace: updatedTippingPlace });
        } catch (error) {
            res.status(500).json({ message: "Failed to update tipping place", error: error.message });
        }
    },

    deleteTippingPlace: async (req, res) => {
        const { id } = req.params;
        try {
            const tippingPlace = await TippingPlace.findByIdAndDelete(id);
            if (!tippingPlace) {
                return res.status(404).json({ message: "Tipping place not found" });
            }
            res.status(200).json({ message: "Tipping place deleted successfully" });
        } catch (error) {
            res.status(500).json({ message: "Failed to delete tipping place", error: error.message });
        }
    },
};

module.exports = tippingPlaceController;
