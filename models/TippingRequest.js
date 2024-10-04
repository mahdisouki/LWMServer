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
        enum: ['Pending', 'Approved', 'Denied'],
        default: 'Pending'
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
}, { timestamps: true });

const TippingRequest = mongoose.model('TippingRequest', tippingRequestSchema);

module.exports = TippingRequest;