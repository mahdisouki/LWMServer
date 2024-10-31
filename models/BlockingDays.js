
const mongoose = require('mongoose');
const { User } = require('./User');

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
const BlockingDays = User.discriminator('blockingDays', blockingDaysSchema);

module.exports = BlockingDays;