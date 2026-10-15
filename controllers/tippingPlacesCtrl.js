const TippingPlace = require('../models/TippingPlaces');
const loggingService = require('../services/loggingService');

const JSON_FIELDS = [
    'daysClosed',
    'itemsAllowed',
    'itemsNotAllowed',
    'minWeightToCharge',
    'weeklySchedule',
    'pricesPerTonne',
    'location',
];

const NUMBER_FIELDS = [
    'pricePerTon',
    'additionalMattressCharge',
    'additionalFridgeCharge',
    'additionalSofaCharge',
    'minimumTonnage',
];

const PRICE_KEYS = ['wood', 'inertConstruction', 'mixedGeneral'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseJsonField(value, fieldName) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        const error = new Error(`${fieldName} must be JSON`);
        error.statusCode = 400;
        throw error;
    }
    try {
        return JSON.parse(trimmed);
    } catch (error) {
        const parseError = new Error(`${fieldName} must be JSON`);
        parseError.statusCode = 400;
        throw parseError;
    }
}

function normalizeNumber(value, label) {
    if (value == null || value === '' || value === 'null') return null;
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
        const error = new Error(`${label} must be a number`);
        error.statusCode = 400;
        throw error;
    }
    return numberValue;
}

function normalizeTippingPlaceBody(body) {
    const data = { ...body };

    JSON_FIELDS.forEach((field) => {
        if (typeof data[field] === 'string') {
            data[field] = parseJsonField(data[field], field);
        }
    });

    NUMBER_FIELDS.forEach((field) => {
        if (field in data) {
            data[field] = normalizeNumber(data[field], field);
        }
    });

    if (data.pricesPerTonne && typeof data.pricesPerTonne === 'object') {
        PRICE_KEYS.forEach((key) => {
            if (key in data.pricesPerTonne) {
                data.pricesPerTonne[key] = normalizeNumber(data.pricesPerTonne[key], `pricesPerTonne.${key}`);
            }
        });
    }

    if (data.weeklySchedule != null && !Array.isArray(data.weeklySchedule)) {
        const error = new Error('weeklySchedule must be an array');
        error.statusCode = 400;
        throw error;
    }

    if (typeof data.email === 'string') {
        data.email = data.email.trim();
        if (data.email && !EMAIL_PATTERN.test(data.email)) {
            const error = new Error('Invalid email address');
            error.statusCode = 400;
            throw error;
        }
    }

    if (typeof data.phoneNumber === 'string') {
        data.phoneNumber = data.phoneNumber.trim();
    }

    return data;
}

function sendTippingPlaceError(res, error, fallbackMessage) {
    const status = error.statusCode || 500;
    res.status(status).json({ message: status === 400 ? error.message : fallbackMessage, error: error.message });
}

const tippingPlaceController = {
    createTippingPlace: async (req, res) => {
        try {
            // Handle image upload if provided
            if (req.file) {
                req.body.image = req.file.path;
            }

            const tippingPlaceData = normalizeTippingPlaceBody(req.body);
            const newTippingPlace = new TippingPlace(tippingPlaceData);
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
            sendTippingPlaceError(res, error, "Failed to create tipping place");
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

            const tippingPlaceData = normalizeTippingPlaceBody(req.body);
            const updatedTippingPlace = await TippingPlace.findByIdAndUpdate(id, tippingPlaceData, { new: true, runValidators: true });

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
            sendTippingPlaceError(res, error, "Failed to update tipping place");
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
