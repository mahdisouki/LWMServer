const mongoose = require('mongoose');
const { Schema } = mongoose;

const expenseSchema = new Schema({
    driverId: {
        type: Schema.Types.ObjectId,
        ref: 'Driver',
        required: true,
    },
    dailySheetId: {
        type: Schema.Types.ObjectId,
        ref: 'DailySheet',
        required: false, // Expense can exist without being linked to a DailySheet
    },
    reason: { type: String, required: true },       // e.g., "Parking", "Toll"
    amount: { type: Number, required: true },       // e.g., 12.5
    location: { type: String },                     // Where the expense happened
    receiptUrl: { type: String },                   // URL to uploaded receipt
    addedBy: { type: String },                      // User name or ID
    // Date/time of the expense (used for filtering and payroll calculations)
    date: { type: Date, required: true, default: Date.now },
    // Backward-compat for old data/queries (prefer using `date`)
    time: { type: Date, required: false },
    linkedToDailySheet: { type: Boolean, default: false },
}, { timestamps: true });

const Expense = mongoose.model('Expense', expenseSchema);
module.exports = Expense;


