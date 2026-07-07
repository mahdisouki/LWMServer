const mongoose = require('mongoose');
const { Schema } = mongoose;
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

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
    expenses: [{ type: Schema.Types.ObjectId, ref: 'Expense' }],
    vanReg:{type: String,},
    workingWith: {type:String},
    totalHoursWorked: { type: Number, default: 0 }, // Total hours worked
    regularHours: { type: Number, default: 0 }, // Regular hours (up to 8h)
    extraHours: { type: Number, default: 0 }, // Extra hours (after 8h)
    appliedHourPrice: { type: Number }, // Optional day-rate override for this payroll
    totalSalary: { type: Number, default: 0 }, // Total salary including extra hours (gross)
    totalExpenses: { type: Number, default: 0 }, // Total expenses incurred by the driver
    totalPcnDamages: { type: Number, default: 0 }, // Total PCN/Damages deducted
    totalCash: { type: Number, default: 0 }, // Total cash received by the driver
    netSalary: { type: Number, default: 0 }, // Persisted net salary: salary - pcn - (cash - expenses)
    status: { type: String, enum: ['Pending', 'Paid'], default: 'Pending' }, // New status field to track payment status
}, { timestamps: true });

// Keep net salary persisted in MongoDB based on payroll policy:
// net = totalSalary - totalPcnDamages - (totalCash - totalExpenses)
payrollSchema.pre('save', function (next) {
    this.totalHoursWorked = round2(this.totalHoursWorked || 0);
    this.regularHours = round2(this.regularHours || 0);
    this.extraHours = round2(this.extraHours || 0);
    this.totalSalary = round2(this.totalSalary || 0);
    this.totalPcnDamages = round2(this.totalPcnDamages || 0);
    this.totalCash = round2(this.totalCash || 0);
    this.totalExpenses = round2(this.totalExpenses || 0);

    const totalSalary = this.totalSalary;
    const totalPcnDamages = this.totalPcnDamages;
    const totalCash = this.totalCash;
    const totalExpenses = this.totalExpenses;
    this.netSalary = round2(totalSalary - totalPcnDamages - (totalCash - totalExpenses));
    next();
});

// Ensure virtual fields are included in JSON
payrollSchema.set('toJSON', { virtuals: true });
payrollSchema.set('toObject', { virtuals: true });

const Payroll = mongoose.model('Payroll', payrollSchema);
module.exports = Payroll;

