const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    createdByType: {
        type: String,
        enum: ['user', 'admin', 'User', 'Admin'],
        default: 'user'
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    image: {
        type: String,

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
    },
    isVisible: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

const Feedback = mongoose.model('Feedback', feedbackSchema);
module.exports = Feedback;
