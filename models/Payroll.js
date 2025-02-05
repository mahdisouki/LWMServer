const mongoose = require('mongoose');
const { Schema } = mongoose;

const payrollSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    startTime: { type: Date },
    endTime: { type: Date },
    truckId:{ type: Schema.Types.ObjectId,
        ref: 'Truck',
        required: true},
    totalHoursWorked: { type: Number, default: 0 }, // Total hours worked
    regularHours: { type: Number, default: 0 }, // Regular hours (up to 8h)
    extraHours: { type: Number, default: 0 }, // Extra hours (after 8h)
    totalSalary: { type: Number, default: 0 }, // Total salary including extra hours
    status: { type: String, enum: ['Pending', 'Paid'], default: 'Pending' }, // New status field to track payment status
}, { timestamps: true });

const Payroll = mongoose.model('Payroll', payrollSchema);
module.exports = Payroll;

