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
  fuelLogs: [
    {
      amount: Number,         // price paid for fuel (e.g., 60.00)
      litres: Number,         // optional: litres of fuel
      time: { type: Date, default: Date.now },  // time of refueling
      station: String,        // optional: station name
      addedBy: {
        type: String,
      },
    }
  ],
  expenses: [
    {
      reason: { type: String, required: true },       // e.g., "Parking", "Toll"
      amount: { type: Number, required: true },       // e.g., 12.5
      location: { type: String },                     // Where the expense happened
      receiptUrl: { type: String },                   // URL to uploaded receipt (e.g., from Cloudinary/S3)
      addedBy: { type: String },                      // User name or ID
      time: { type: Date, default: Date.now },        // Time of the expense
    }
  ],
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
