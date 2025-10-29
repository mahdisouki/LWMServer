const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true,
        trim: true
    },
    description: { 
        type: String, 
        required: true,
        trim: true
    },
    image: { 
        type: String, 
        required: true
    },
    date: { 
        type: Date, 
        default: Date.now 
    },
    rate: {
        type: Number,
        min: 0,
        max: 5,
        required: true
    }
}, {
    timestamps: true
});

const Feedback = mongoose.model('Feedback', feedbackSchema);
module.exports = Feedback;
