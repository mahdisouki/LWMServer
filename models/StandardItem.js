const mongoose = require('mongoose');

const standardItemSchema = new mongoose.Schema({
    itemName: { type: String, required: true },
    image: { type: String, required: true },
    images: [{ type: String }],
    price: { type: Number, required: true },
    category: [{type:mongoose.Types.ObjectId , ref:"serviceCategory"}], 
    description: { type: String, required: false },
    insidePrice: { type: Number, required: false , default: 6},
    insideWithDismantlingPrice: { type: Number, required: false , default: 18},
    Objectsposition: {
        type: String,
        enum: ["Inside", "Outside", "InsideWithDismantling"],
        default: "Outside",
      },
      ewcCode: {type:String , required:false}
});

const StandardItem = mongoose.model('StandardItem', standardItemSchema);
module.exports = StandardItem;
