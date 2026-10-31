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
    phoneNumber: {
        type: String,
        trim: true,
    },
    email: {
        type: String,
        trim: true,
    },
    weeklySchedule: [{
        day: {
            type: String,
            enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        },
        closed: {
            type: Boolean,
            default: false,
        },
        openTime: {
            type: String,
        },
        closeTime: {
            type: String,
        },
    }],
    pricesPerTonne: {
        wood: { type: Number },
        inertConstruction: { type: Number },
        mixedGeneral: { type: Number },
    },
    minimumTonnage: {
        type: Number,
    },
    tipDuration: {
        type: Number,
        min: 0,
    },
    paymentInstructions: {
        type: String,
    },
    notes: {
        type: String,
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
    image: {
        type: String
    },
}, { timestamps: true });

const TippingPlace = mongoose.model('TippingPlace', TippingPlaceSchema);
module.exports = TippingPlace;
