const mongoose = require('mongoose');

const standardItemSchema = new mongoose.Schema({
    itemName: { type: String, required: true },
    image: { type: String, required: true },
    price: { type: Number, required: true },
    category: { type: String, required: true },
    description: { type: String, required: false },

    // additionalFees: [{
    //     condition: String,
    //     amount: Number,
    // }]
});

const StandardItem = mongoose.model('StandardItem', standardItemSchema);
module.exports = StandardItem;
