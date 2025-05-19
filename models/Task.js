const mongoose = require("mongoose");
const { Schema } = mongoose;
const StandardItem = require('../models/StandardItem'); // Ajustez le chemin si nécessaire
const Counter = require('./Counter');
const DailySheet = require('./DailySheet');

const taskSchema = new Schema(
  {
    orderNumber: { type: String, unique: true },
    // clientId: { type: Schema.Types.ObjectId, ref: "Client", required: false },
    truckId: { type: Schema.Types.ObjectId, ref: "Truck", required: false },
    firstName: { type: String, required: true },
    billingAddress: { type: String },
    collectionAddress: {type:String},
    lastName: { type: String, required: true },
    bussinessName: { type: String },
    phoneNumber: { type: String, required: true },
    phoneNumber2: { type: String },
    clientObjectPhotos: [{ type: String, required: true }],
    totalPrice: { type: Number, required: true },
    postcode: { type: String, required: true },
    items: [
      {
        standardItemId: { type: mongoose.Types.ObjectId, ref: "StandardItem" },
        object: { type: String },  // if others 
        Objectsposition: {
          type: String,
          enum: ["Inside", "Outside", "InsideWithDismantling"],
          default: "Outside",
        },
        quantity: { type: Number, default: 0 },
        price: { type: Number },
        customPrice: { type: Number },
      },
    ],
    initialConditionPhotos: [
      {
        items: [{ type: String }],
        description: { type: String },
      },
    ],
    intermediateConditionPhotos: [
      {
        items: [{ type: String }],
        description: { type: String },
      },
    ],
    finalConditionPhotos: [
      {
        items: [{ type: String }],
        description: { type: String },
      },
    ],
    additionalItems: [
      {
        items: [{ type: String }],
        description: { type: String },
      },
    ],
    location: {
      type: {
        type: String,
        enum: ["Point"],
        required: false,
      },
      coordinates: {
        type: [Number],
        required: false,
      },
      address: { type: String, required: false },
    },
    date: { type: Date, required: true },
    available: {
      type: String,
      enum: ["AnyTime", "7am-12pm", "12pm-5pm"],
      default: "AnyTime"
    },

    createdBy: {
      type:String, // or 'Admin' depending on your auth model
      required: false,
    },
    createdByType: {
      type: String,
      enum: ['Admin', 'public'],
      default: 'public',
    },
    paymentStatus: {
      type: String,
      enum: ["partial_Paid","Paid","partial_Refunded", "refunded", "Unpaid" ,"Failed"],
      default: "Unpaid",
    },
    taskStatus: {
      type: String,
      enum: ["Not_Completed", "Completed" ,"Cancelled" ,"On_Hold" ,"Processing"],
      default: "Not_Completed",
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "BankTransfer", "payment_link" , "partial_payment", "online"],
      default: "cash",
    },
    paidAmount: {
      amount: { type: Number},
      method: {
      type: String,
      enum: ["BankTransfer", "payment_link", "online" , "cash"],
    },
    status: {
      type: String,
      enum: ["Paid", "Not_Paid"],
      default: "Not_Paid",
    },
    },
    remainingAmount: {
      amount: { type: Number },
      method: {
        type: String,
        enum: ["BankTransfer", "payment_link", "online" , "cash"],
      },
      status: {
        type: String,
        enum: ["Paid", "Not_Paid"],
        default: "Not_Paid",
      },
    },
    customDiscountPercent: { type: Number, default: 0 },
    email: { type: String },
    additionalNotes: { type: String, required: false },
    itemDescription: { type: String, required: false },
    clientFeedback: { type: String },
    clientFeedbackScale: { type: Number },
    startDate: { type: Date },
    finishDate: { type: Date },
    timeSpent: { type: Number },
    cashReceived: { type: Number },
    cashReceivedBy: { type: String },
    repeatCustomer: { type: Number, default: 0 },
    reviewRequestSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Add pre-save middleware to auto-increment order number
taskSchema.pre('save', async function(next) {
  // Only generate order number for new documents
  if (this.isNew && !this.orderNumber) {
    try {
      const counter = await Counter.findByIdAndUpdate(
        { _id: 'orderNumber' },
        { $inc: { sequence_value: 1 } },
        { new: true, upsert: true }
      );
      this.orderNumber = `ORD${String(counter.sequence_value).padStart(6, '0')}`;
      next();
    } catch (error) {
      next(error);
    }
  } else {
    next();
  }
});

// Post-save hook to update DailySheet when task is assigned to a truck
taskSchema.post('save', async function(doc) {
  try {
    // Only proceed if the task has a truckId
    if (!doc.truckId) return;

    // Get the truck to find the driver
    const Truck = mongoose.model('Truck');
    const truck = await Truck.findById(doc.truckId);
    if (!truck || !truck.driverId) return;

    // Get the task date in YYYY-MM-DD format
    const taskDate = doc.date.toISOString().split('T')[0];

    // Find or create a DailySheet for this driver and date
    let dailySheet = await DailySheet.findOne({
      driverId: truck.driverId,
      date: {
        $gte: new Date(taskDate + 'T00:00:00.000Z'),
        $lt: new Date(taskDate + 'T23:59:59.999Z')
      }
    });

    if (!dailySheet) {
      dailySheet = new DailySheet({
        driverId: truck.driverId,
        date: doc.date,
        jobsPending: [doc._id]
      });
    } else {
      // Add task to jobsPending if not already in any of the job arrays
      if (!dailySheet.jobsDone.includes(doc._id) && 
          !dailySheet.jobsPending.includes(doc._id) && 
          !dailySheet.jobsCancelled.includes(doc._id)) {
        dailySheet.jobsPending.push(doc._id);
      }
    }

    await dailySheet.save();
  } catch (error) {
    console.error('Error updating DailySheet:', error);
  }
});

// Pre-save hook to handle task status changes
taskSchema.pre('save', async function(next) {
  try {
    // Only proceed if taskStatus is being modified
    if (!this.isModified('taskStatus')) {
      return next();
    }

    // Get the truck to find the driver
    const Truck = mongoose.model('Truck');
    const truck = await Truck.findById(this.truckId);
    if (!truck || !truck.driverId) return next();

    // Get the task date in YYYY-MM-DD format
    const taskDate = this.date.toISOString().split('T')[0];

    // Find the DailySheet for this driver and date
    const dailySheet = await DailySheet.findOne({
      driverId: truck.driverId,
      date: {
        $gte: new Date(taskDate + 'T00:00:00.000Z'),
        $lt: new Date(taskDate + 'T23:59:59.999Z')
      }
    });

    if (dailySheet) {
      // Remove task from all job arrays
      dailySheet.jobsDone = dailySheet.jobsDone.filter(id => !id.equals(this._id));
      dailySheet.jobsPending = dailySheet.jobsPending.filter(id => !id.equals(this._id));
      dailySheet.jobsCancelled = dailySheet.jobsCancelled.filter(id => !id.equals(this._id));

      // Add task to appropriate array based on new status
      switch (this.taskStatus) {
        case 'Completed':
          dailySheet.jobsDone.push(this._id);
          break;
        case 'Processing':
          dailySheet.jobsPending.push(this._id);
          break;
        case 'Declined':
          dailySheet.jobsCancelled.push(this._id);
          break;
      }

      await dailySheet.save();
    }
    next();
  } catch (error) {
    next(error);
  }
});

const Task = mongoose.model("Task", taskSchema);
module.exports = Task;
