const mongoose = require('mongoose');
const { Schema } = mongoose;

const incompleteTaskSchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    taskStatus: { type: String, required: true },
  },
  { _id: false }
);

const endShiftRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    payrollId: { type: Schema.Types.ObjectId, ref: 'Payroll', required: true },
    truckId: { type: Schema.Types.ObjectId, ref: 'Truck' },
    dateKey: { type: String, required: true },
    requestedEndTime: { type: Date, required: true },
    incompleteTasks: { type: [incompleteTaskSchema], default: [] },
    driverNotes: { type: String },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
      default: 'Pending',
      required: true,
    },
  },
  { timestamps: true }
);

endShiftRequestSchema.index({ payrollId: 1, status: 1 });

const EndShiftRequest = mongoose.model('EndShiftRequest', endShiftRequestSchema);
module.exports = EndShiftRequest;
