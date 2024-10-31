const mongoose = require('mongoose');

const standardItemSchema = new mongoose.Schema({
    itemName:{
        type:String,
        required:true
    },
    image:{
        type:String,
        require:true
    },
    price:{
        type:Number,
        required:true
    }
});
const StandardItem = mongoose.model('standardItem', standardItemSchema);

module.exports = StandardItem;