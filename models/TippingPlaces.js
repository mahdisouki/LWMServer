const mongoose = require('mongoose');
const { Schema } = mongoose;

const TippingPlaceSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    address: {
        type: String,
        required: true
    },
    daysClosed: [{
        type: String
    }],
    operatingHours: {
        type: String
    },
    itemsAllowed: [{
        type: String
    }],
    itemsNotAllowed: [{
        type: String
    }],
    pricePerTon: {
        type: Number
    },
    minWeightToCharge: {
        weight: { type: String },
        price: { type: String }
    },
    additionalMattressCharge: {
        type: Number
    },
    additionalFridgeCharge: {
        type: Number
    },
    additionalSofaCharge: {
        type: Number
    },
    location: {
        type: {
          type: String,
          enum: ["Point"],
          required: false,
        },
        coordinates: {
          type: [Number],
          required: false,
        },
      },
}, { timestamps: true });

const TippingPlace = mongoose.model('TippingPlace', TippingPlaceSchema);
module.exports = TippingPlace;
