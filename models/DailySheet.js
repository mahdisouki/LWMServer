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
  // Total cash received from all tasks paid in cash
  totalCash: { type: Number, default: 0 }
}, { timestamps: true });

// Pre-save hook to calculate total cash from all tasks
dailySheetSchema.pre('save', async function(next) {
  try {
    // Combine all job IDs from different statuses
    const allJobIds = [
      ...(this.jobsDone || []),
      ...(this.jobsPending || []),
      ...(this.jobsCancelled || [])
    ];

    // Only calculate if we have any jobs
    if (allJobIds.length > 0) {
      const Task = mongoose.model('Task');
      const tasks = await Task.find({
        _id: { $in: allJobIds },
        paymentMethod: 'cash'
      });
      
      // Sum up cash received from all cash-paid tasks
      this.totalCash = tasks.reduce((sum, task) => sum + (task.cashReceived || 0), 0);
    }
    next();
  } catch (error) {
    next(error);
  }
});

const DailySheet = mongoose.model('DailySheet', dailySheetSchema);
module.exports = DailySheet;
