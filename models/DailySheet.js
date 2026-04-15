const mongoose = require('mongoose');
const { Schema } = mongoose;

const dailySheetSchema = new Schema({
  driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },  // Reference to the Driver
  truckId: { type: Schema.Types.ObjectId, ref: 'Truck', required: true },  // Reference to the Truck
  date: { type: Date, default: Date.now, required: true },  // The date of the daily sheet
  vanId: { type: Schema.Types.ObjectId, ref: 'Van', required: true },  // Reference to the Van
  helperId: { type: Schema.Types.ObjectId, ref: 'Helper', required: false },  // Reference to the Helper
  // Jobs: group them by status
  jobsDone: [{ type: Schema.Types.ObjectId, ref: 'Task' }],      // List of completed jobs
  jobsPending: [{ type: Schema.Types.ObjectId, ref: 'Task' }],   // List of pending jobs
  jobsCancelled: [{ type: Schema.Types.ObjectId, ref: 'Task' }], // List of cancelled jobs

  // Tipping requests for the day
  tippingRequests: [{ type: Schema.Types.ObjectId, ref: 'TippingRequest' }],
  pcnDamages: [{ type: Schema.Types.ObjectId, ref: 'PcnDamage' }],
  fuelLogs: [{ type: Schema.Types.ObjectId, ref: 'Fuel' }],
  // References to Expense documents
  expenses: [{ type: Schema.Types.ObjectId, ref: 'Expense' }],
  // Total cash received from all tasks paid in cash
  totalCash: { type: Number, default: 0 }
}, { timestamps: true });

// Pre-save hook to calculate total cash from all tasks
dailySheetSchema.pre('save', async function (next) {
  try {
    const previousTotalCash = this.isModified('totalCash') ? this.totalCash : (this.totalCash || 0);

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

      // Sum up cash received from all cash-paid tasks (cash + extra cash)
      this.totalCash = tasks.reduce(
        (sum, task) => sum + (task.cashReceived || 0) + (task.extraCashReceived || 0),
        0,
      );
      console.log(
        '[DailySheet] totalCash recalculated for sheet',
        this._id ? this._id.toString() : '(new)',
        'from',
        previousTotalCash,
        'to',
        this.totalCash,
      );
    }
    next();
  } catch (error) {
    next(error);
  }
});

const DailySheet = mongoose.model('DailySheet', dailySheetSchema);
module.exports = DailySheet;
