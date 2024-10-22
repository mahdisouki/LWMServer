const mongoose = require('mongoose');
const { Schema } = mongoose;

const dailySheetSchema = new Schema({
  driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },  // Reference to the Driver
  date: { type: Date, default: Date.now, required: true },  // The date of the daily sheet

  // Jobs: group them by status
  jobsDone: [{ type: Schema.Types.ObjectId, ref: 'Task' }],      // List of completed jobs
  jobsPending: [{ type: Schema.Types.ObjectId, ref: 'Task' }],   // List of pending jobs
  jobsCancelled: [{ type: Schema.Types.ObjectId, ref: 'Task' }], // List of cancelled jobs

  // Tipping requests for the day
  tippingRequests: [{ type: Schema.Types.ObjectId, ref: 'TippingRequest' }], 

  // Incomes, either from cash or other payment methods
  income: {
    cash: { type: Number, default: 0 },     // Cash amount received
    card: { type: Number, default: 0 },     // Card payments (if needed)
    total: { type: Number, default: 0 },    // Total income
  },
}, { timestamps: true });

// Add any pre-save hooks or methods if needed
dailySheetSchema.pre('save', function(next) {
  this.income.total = this.income.cash + this.income.card;
  next();
});

const DailySheet = mongoose.model('DailySheet', dailySheetSchema);
module.exports = DailySheet;
