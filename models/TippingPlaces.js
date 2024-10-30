const mongoose = require('mongoose');
const { Schema } = mongoose;

const TippingPlaceSchema = new Schema({
    tippingName:{
        type:String,
        required:true
    },
    address:{
        type:String,
        required:true
    },
    location:{
        
    },
    daysClosed:[
        {type:String}
    ],
    operatingHours:{
        type:String
    },
    itemsAllowed:[
        {type:String}
    ],
    itemNotAllowed:[
        {type:String}
    ],
    pricePerTon:{
        type:Number
    },
    minWeightToCharge:{
        weight:{type:String},
        price:{type:String}
    },
    additionalMattressCharge:{
        type:Number,
    },
    additionalFridgeCharge:{
        type:Number
    },
    additionalSofaCharge:{
        type:Number
    }




}, { timestamps: true });

const TippingPlace = mongoose.model('tippingPlace', TippingPlaceSchema);
module.exports = TippingPlace;

