const mongoose = require("mongoose");
const { Schema } = mongoose;
const StandardItem = require('../models/StandardItem'); // Ajustez le chemin si nécessaire
const Counter = require('./Counter');
const DailySheet = require('./DailySheet');
const EWC_CODES = require('../config/ewcCodes');
const { getAssignedForDayFromRanges } = require('../services/unitAssignmentLogService');

const taskSchema = new Schema(
  {
    orderNumber: { type: String, unique: true },
    // clientId: { type: Schema.Types.ObjectId, ref: "Client", required: false },
    truckId: { type: Schema.Types.ObjectId, ref: "Truck", required: false },
    firstName: { type: String, required: true },
    billingAddress: { type: String },
    collectionAddress: { type: String },
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
        spaceOfVan: { type: Number, required: false },
        timespentOutside: { type: Number, required: false },
        timespentInside: { type: Number, required: false },
        timespentInsdiewithDis: { type: Number, required: false },
        /** Custom items: copy times/position from matching standard load item when set. */
        vanLoadOption: {
          type: String,
          enum: ['1/4 Load', '1/2 Load', '3/4 Load', 'Full Load / Large Load'],
          required: false,
        },
        customPrice: { type: Number },
        ewcCode: {
          type: String,
          required: false,
          enum: EWC_CODES, // Enumerated EWC codes for custom items
        },
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
      type: String, // or 'Admin' depending on your auth model
      required: false,
    },
    createdByType: {
      type: String,
      enum: ['Admin', 'public'],
      default: 'public',
    },
    paymentStatus: {
      type: String,
      enum: ["partial_Paid", "Paid", "partial_Refunded", "refunded", "Unpaid", "Failed"],
      default: "Unpaid",
    },
    taskStatus: {
      type: String,
      enum: ["Not_Completed", "Completed", "Cancelled", "On_Hold", "Processing", "New"],
      default: "Not_Completed",
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "BankTransfer", "payment_link", "partial_payment", "online"],
      default: "cash",
    },
    paidAmount: {
      amount: { type: Number },
      method: {
        type: String,
        enum: ["BankTransfer", "payment_link", "online", "cash"],
        default: "cash",
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
        enum: ["BankTransfer", "payment_link", "online", "cash"],
        default: "cash",
      },
      status: {
        type: String,
        enum: ["Paid", "Not_Paid"],
        default: "Not_Paid",
      },
    },
    hasDiscount: { type: Boolean, default: false },
    discountType: { type: String, enum: ["perItem", "percentage"] },
    customDiscountPercent: { type: Number, default: 0 },
    couponCode: { type: String, default: null }, // Coupon code applied to this task
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon", default: null }, // Reference to coupon used
    couponUsageIncremented: { type: Boolean, default: false }, // Prevent double increment of coupon usage (idempotency)
    email: { type: String },
    additionalNotes: { type: String, required: false },
    privateNotes: { type: String },
    itemDescription: { type: String, required: false },
    clientFeedback: { type: String },
    clientFeedbackScale: { type: Number },
    startDate: { type: Date },
    finishDate: { type: Date },
    timeSpent: { type: Number },
    cashReceived: { type: Number },
    // Who actually took the cash for this task (User id)
    cashReceivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    customerSignature: { type: String }, // Path to customer signature image
    customerNotPresent: { type: Boolean, default: false }, // Driver can tick if customer is not present
    repeatCustomer: { type: Number, default: 0 },
    reviewRequestSent: { type: Boolean, default: false },
    preventReviewEmail: { type: Boolean, default: false }, // Prevent sending review email for this task
    wasteTransferNoteSent: { type: Boolean, default: false },
    retargetingEmailSent: { type: Boolean, default: false }, // Track if retargeting email was sent
    retargetingEmailSentAt: { type: Date }, // When retargeting email was sent
    retargetingCoupon20Id: { type: Schema.Types.ObjectId, ref: "Coupon", default: null }, // Reference to 20% coupon
    retargetingCoupon10Id: { type: Schema.Types.ObjectId, ref: "Coupon", default: null }, // Reference to 10% coupon
    reasonForCancellation: { type: String },
    applyMinFee: { type: Boolean, default: false }, // Admin option to apply minimum fee
    applySundayFee: { type: Boolean, default: false }, // Admin option to apply Sunday fee
    quotationId: {
      type: Schema.Types.ObjectId,
      ref: 'QuotationRequest', // Reference to your Quotation model
      required: false, // Make it optional
      default: null
    },
    taskDuration: { type: Number, required: false },
    spaceOfVan: { type: Number, required: false },
    googleCalendarEventId: {
      type: String,
      required: false
    },
  },
  { timestamps: true }
);


// Add a pre-save hook to clean up empty items and validate data
taskSchema.pre('save', function (next) {
  // Filter out items where both standardItemId is null and object is empty
  this.items = this.items.filter(item => {
    return !(item.standardItemId === null && (!item.object || item.object.trim() === ''));
  });

  // Validate items have proper pricing
  this.items.forEach((item, index) => {
    // If standardItemId is null, ensure item.price exists and is > 0
    if (!item.standardItemId && (!item.price || item.price <= 0)) {
      console.warn(`Task ${this.orderNumber}: Item ${index} has no standardItemId and invalid price: ${item.price}`);
    }

    // Ensure quantity is valid
    if (!item.quantity || item.quantity <= 0) {
      item.quantity = 1; // Default to 1 if invalid
    }

    // Ensure Objectsposition is valid
    if (!item.Objectsposition) {
      item.Objectsposition = 'Outside'; // Default to Outside
    }
  });

  next();
});
// Add pre-findOneAndUpdate middleware to clean up empty items
taskSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate();

  // Check if items array is being updated
  if (update.$set && update.$set.items) {
    // Filter out items where both standardItemId is null and object is empty
    update.$set.items = update.$set.items.filter(item => {
      return !(item.standardItemId === null && (!item.object || item.object.trim() === ''));
    });
  }
  next();
});

// Add pre-save middleware to auto-increment order number
taskSchema.pre('save', async function (next) {
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
taskSchema.post('save', async function (doc) {
  try {
    // Only proceed if the task has a truckId
    if (!doc.truckId) return;

    // Get the truck to find the driver
    const Truck = mongoose.model('Truck');
    const truck = await Truck.findById(doc.truckId);
    if (!truck || !truck.driverId) return;

    // Get the task date in YYYY-MM-DD format
    const taskDate = doc.date.toISOString().split('T')[0];

    // Find or create a DailySheet for this driver, truck and date
    let dailySheet = await DailySheet.findOne({
      driverId: truck.driverId,
      truckId: truck._id,
      date: {
        $gte: new Date(taskDate + 'T00:00:00.000Z'),
        $lt: new Date(taskDate + 'T23:59:59.999Z')
      }
    });

    if (!dailySheet) {
      const assigned = await getAssignedForDayFromRanges(truck._id, taskDate);
      dailySheet = new DailySheet({
        driverId: assigned.driverId || truck.driverId,
        truckId: truck._id,
        vanId: assigned.vanId || truck.vanId,
        helperId: assigned.helperId || truck.helperId,
        date: doc.date,
        jobsPending: [doc._id]
      });
    } else {
      // Sync driver/van/helper from assignment ranges for this day
      const assigned = await getAssignedForDayFromRanges(truck._id, taskDate);
      if (assigned.driverId) dailySheet.driverId = assigned.driverId;
      if (assigned.vanId) dailySheet.vanId = assigned.vanId;
      if (assigned.helperId) dailySheet.helperId = assigned.helperId;
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
taskSchema.pre('save', async function (next) {
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

    // Find the DailySheet for this driver, truck and date
    const dailySheet = await DailySheet.findOne({
      driverId: truck.driverId,
      truckId: this.truckId,
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
