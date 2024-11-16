const mongoose = require('mongoose');

const serviceCategorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    icon: { type: String, required: true },
    description:{type:String}
});

const ServiceCategory = mongoose.model('serviceCategory', serviceCategorySchema);
module.exports = ServiceCategory;
