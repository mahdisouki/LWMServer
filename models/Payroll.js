const mongoose = require('mongoose');
const { Schema } = mongoose;

const payrollSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    startTime: { type: Date},
    endTime: { type: Date },
    totalHoursWorked: { type: Number, default: 0 },
    totalSalary: { type: Number, default: 0 }
}, { timestamps: true });

// Optionally add a pre-save hook if needed for automatic calculations before saving.

const Payroll = mongoose.model('Payroll', payrollSchema);
module.exports = Payroll;