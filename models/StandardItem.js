const mongoose = require('mongoose');

const standardItemSchema = new mongoose.Schema({
    itemName: { type: String, required: true },
    image: { type: String, required: true },
    price: { type: Number, required: true },
    category: [{type:mongoose.Types.ObjectId , ref:"serviceCategory"}], 
    description: { type: String, required: false },
});

const StandardItem = mongoose.model('StandardItem', standardItemSchema);
module.exports = StandardItem;
