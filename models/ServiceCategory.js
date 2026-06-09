const mongoose = require('mongoose');

const serviceCategorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    icon: { type: String, required: true },
    topDescription: { type: String },
    bottomDescription: { type: String },
    purchasedCount: { type: Number, default: 0 },
    timesPurchased: { type: Number, default: 0 },
    popularityUpdatedAt: { type: Date, default: null },
});

const ServiceCategory = mongoose.model('serviceCategory', serviceCategorySchema);
module.exports = ServiceCategory;
