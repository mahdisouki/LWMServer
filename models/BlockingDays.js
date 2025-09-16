
const mongoose = require('mongoose');

const blockingDaysSchema = new mongoose.Schema({
    date: {
        type: Date,
    },
    type: {
        type: String,
        enum: ['holiday', 'dayoff', 'other', 'full jobs'],
        required: false
    },
    timeSlots: [{
        type: String,
        enum: ['AnyTime', '7am-12pm', '12pm-5pm'],
        required: true
    }]
}, {
    timestamps: true
});
const BlockingDays = mongoose.model('blockingDays', blockingDaysSchema);

module.exports = BlockingDays;