const mongoose = require('mongoose');
const { Schema } = mongoose;

const tippingRequestSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    truckId: {
        type: Schema.Types.ObjectId,
        ref: 'Truck',
        required: true
    },
    notes: {
        type: String
    },
    status: {
        type: String,
        enum: ['Pending', 'GoToStorage', 'GoToTipping', 'TippingAndStorage', 'Denied'],
        default: 'Pending'
    },
    isShipped: {
        type: Boolean,
        default: false
    },
    tippingProof: {
        type: [String]
    },
    price: {
        type: Number
    },
    tippingPlace: {
        type: Schema.Types.ObjectId,
        ref: "TippingPlace"
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

const TippingRequest = mongoose.model('TippingRequest', tippingRequestSchema);

module.exports = TippingRequest;