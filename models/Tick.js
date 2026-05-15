const mongoose = require('mongoose');
const { Schema } = mongoose;
const Task = require('./Task');

// Tick list tasks: Completed, fully Unpaid OR partial_Paid with remaining balance still Not_Paid
const eligibleTaskFilter = {
  taskStatus: 'Completed',
  $or: [
    { paymentStatus: 'Unpaid' },
    {
      paymentStatus: 'partial_Paid',
      'remainingAmount.status': 'Not_Paid',
    },
  ],
};

const tickSchema = new Schema(
  {
    taskId: {
      type: Schema.Types.ObjectId,
      ref: 'Task',
      required: true,
      unique: true,
    },
    note: {
      type: String,
      default: '',
      trim: true,
    },
    lastModifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

tickSchema.index({ taskId: 1 });
tickSchema.index({ updatedAt: -1 });

tickSchema.statics.eligibleTaskFilter = eligibleTaskFilter;

/** Create a tick per eligible task; remove ticks when task is no longer eligible. */
tickSchema.statics.syncFromEligibleTasks = async function () {
  const eligible = await Task.find(eligibleTaskFilter).select('_id').lean();
  const eligibleIds = eligible.map((t) => t._id);

  await this.deleteMany({ taskId: { $nin: eligibleIds } });

  if (eligibleIds.length === 0) return;

  await this.bulkWrite(
    eligibleIds.map((taskId) => ({
      updateOne: {
        filter: { taskId },
        update: { $setOnInsert: { note: '' } },
        upsert: true,
      },
    }))
  );
};

const Tick = mongoose.model('Tick', tickSchema);
module.exports = Tick;
