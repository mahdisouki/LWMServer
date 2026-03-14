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
    notes: { type: String },
    startBreak: { type: Date },
    endBreak: { type: Date },
    totalBreak: { type: Number, default: 0 }, // Total break time in hours
    truckId: {
        type: Schema.Types.ObjectId,
        ref: 'Truck'
    },
    pcnDamages:[{type: Schema.Types.ObjectId, ref: 'PcnDamage'}],
    vanReg:{type: String,},
    workingWith: {type:String},
    totalHoursWorked: { type: Number, default: 0 }, // Total hours worked
    regularHours: { type: Number, default: 0 }, // Regular hours (up to 8h)
    extraHours: { type: Number, default: 0 }, // Extra hours (after 8h)
    totalSalary: { type: Number, default: 0 }, // Total salary including extra hours (gross)
    totalExpenses: { type: Number, default: 0 }, // Total expenses incurred by the driver
    totalPcnDamages: { type: Number, default: 0 }, // Total PCN/Damages deducted
    totalCash: { type: Number, default: 0 }, // Total cash received by the driver
    status: { type: String, enum: ['Pending', 'Paid'], default: 'Pending' }, // New status field to track payment status
}, { timestamps: true });

// Virtual for net salary (totalSalary - totalPcnDamages )
payrollSchema.virtual('netSalary').get(function () {
    return (this.totalSalary || 0) - (this.totalPcnDamages || 0);
});

// Ensure virtual fields are included in JSON
payrollSchema.set('toJSON', { virtuals: true });
payrollSchema.set('toObject', { virtuals: true });

const Payroll = mongoose.model('Payroll', payrollSchema);
module.exports = Payroll;

