
const mongoose = require('mongoose');

const blockingDaysSchema = new mongoose.Schema({
    date:{
        type:Date,
    },
    type:{
        type:String,
        enum: ['holiday', 'dayoff', 'other'],
        default: 'dayoff'
    }
});
const BlockingDays = mongoose.model('blockingDays', blockingDaysSchema);

module.exports = BlockingDays;