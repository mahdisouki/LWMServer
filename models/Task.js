const mongoose = require("mongoose");
const { Schema } = mongoose;
const { resolveIsBusinessEmail } = require('../utils/businessEmail');
const { resolveTrafficSource } = require('../utils/trafficSource');
const StandardItem = require('../models/StandardItem'); // Ajustez le chemin si nécessaire
const Counter = require('./Counter');
const DailySheet = require('./DailySheet');
const EWC_CODES = require('../config/ewcCodes');
const { getAssignedForDayFromRanges } = require('../services/unitAssignmentLogService');
const Van = require('./Van');

const VAN_LOAD_OPTION_PERCENT = {
  '1/4 Load': 25,
  '1/2 Load': 50,
  '3/4 Load': 75,
  'Full Load / Large Load': 100,
};

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Compute van-load usage from `task.items` (0–100) and per-item breakdown.
 * - Standard items: (qty / spaceOfVan) * 100
 * - Custom items with vanLoadOption: qty * mapped percentage
 *
 * Total is capped at 100; per-item percents are scaled proportionally to match the cap.
 */
async function resolveTaskVanLoadDetails(task) {
  const items = task?.items;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return { usedSpace: 0, perItem: [] };
  }

  const perItemRaw = new Map(); // key -> { rawPercent, quantity }
  let totalRawPercent = 0;

  for (const item of items) {
    const qty = Math.max(0, Number(item.quantity) || 1);

    if (item.standardItemId) {
      const std = await StandardItem.findById(item.standardItemId)
        .select('itemName spaceOfVan')
        .lean();

      let spaceOfVan = Number(item.spaceOfVan);
      if (!Number.isFinite(spaceOfVan) || spaceOfVan <= 0) {
        spaceOfVan = Number(std?.spaceOfVan);
      }

      if (Number.isFinite(spaceOfVan) && spaceOfVan > 0) {
        const percent = (qty / spaceOfVan) * 100;
        totalRawPercent += percent;

        const key = std?.itemName || item.standardItemId.toString();
        const prev = perItemRaw.get(key) || { rawPercent: 0, quantity: 0 };
        perItemRaw.set(key, { rawPercent: prev.rawPercent + percent, quantity: prev.quantity + qty });
      }
    } else if (item.vanLoadOption && VAN_LOAD_OPTION_PERCENT[item.vanLoadOption] != null) {
      const percent = qty * VAN_LOAD_OPTION_PERCENT[item.vanLoadOption];
      totalRawPercent += percent;

      const key = item.object || item.vanLoadOption || 'Custom';
      const prev = perItemRaw.get(key) || { rawPercent: 0, quantity: 0 };
      perItemRaw.set(key, { rawPercent: prev.rawPercent + percent, quantity: prev.quantity + qty });
    }
  }

  if (totalRawPercent <= 0) {
    return { usedSpace: 0, perItem: [] };
  }

  const totalCappedPercent = Math.min(100, totalRawPercent);
  const usedSpace = Math.round(totalCappedPercent);
  const scale = totalCappedPercent / totalRawPercent;

  const perItem = [...perItemRaw.entries()].map(([itemKey, v]) => ({
    item: itemKey,
    quantity: v.quantity,
    spaceOfVan: round2(v.rawPercent * scale),
  }));

  return { usedSpace, perItem };
}

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
      enum: ['Admin', 'public', 'broker'],
      default: 'public',
    },
    // Unlocks admin editing and pricing on a public order without changing its origin.
    adminEditingEnabled: {
      type: Boolean,
      default: false,
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
    isBusinessEmail: { type: Boolean, default: false },
    excludedFromBusinessList: { type: Boolean, default: false },
    note: { type: String, default: '', trim: true },
    followUp: { type: String, default: '', trim: true },
    industry: { type: String, default: '', trim: true },
    call: { type: Boolean, default: false },
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
    paymentLinkRetryEmailSent: { type: Boolean, default: false },
    paymentLinkRetryEmailSentAt: { type: Date },
    retargetingCoupon20Id: { type: Schema.Types.ObjectId, ref: "Coupon", default: null }, // Reference to 20% coupon
    retargetingCoupon10Id: { type: Schema.Types.ObjectId, ref: "Coupon", default: null }, // Reference to 10% coupon
    reasonForCancellation: { type: String },
    applyMinFee: { type: Boolean, default: false }, // Admin option to apply minimum fee
    applySundayFee: { type: Boolean, default: false }, // Admin option to apply Sunday fee
    priority:{
      type:String,
      enum: ['low', 'medium', 'high'],
      default: 'low',
    },
    redflag: { type: Boolean, default: false },
    redflagNote: { type: String },
    redflagBy: { type: Schema.Types.ObjectId, ref: 'User' },
    redflagAt: { type: Date },
    quotationId: {
      type: Schema.Types.ObjectId,
      ref: 'QuotationRequest', // Reference to your Quotation model
      required: false, // Make it optional
      default: null
    },
    parentTaskId: {
      type: Schema.Types.ObjectId,
      ref: 'Task',
      default: null,
    },
    linkedTaskType: {
      type: String,
      enum: ['main', 'additional_items'],
      default: 'main',
    },
    taskDuration: { type: Number, required: false },
    spaceOfVan: { type: Number, required: false },
    googleCalendarEventId: {
      type: String,
      required: false
    },
    gclid: { type: String, required: false },
    gbraid: { type: String, required: false },
    wbraid: { type: String, required: false },
    msclkid: { type: String, required: false },
    fbclid: { type: String, required: false },
    utm_source: { type: String, required: false },
    trafficSource: {
      type: String,
      enum: ['Google Ads', 'LSA', 'Microsoft Ads', 'Instagram', 'Facebook', 'Direct', 'Organic'],
      default: 'Organic',
    },
    /** How the job arrived. Independent of trafficSource (ads/organic) and createdByType. */
    subsource: {
      type: String,
      enum: ['tawk', 'phone', 'email', 'website', null],
      default: null,
    },
    /** Raw GA4 sessionDefaultChannelGroup from purchase ↔ orderNumber match. */
    ga4SessionChannel: { type: String, required: false },
    ga4TrafficChannelSyncedAt: { type: Date, required: false },
    /** Google Ads Local Services lead id from weekly LSA → order match. */
    lsaLeadId: { type: String, required: false },
    lsaTrafficSyncedAt: { type: Date, required: false },
    googleAdsPurchaseConversionSentAt: { type: Date, required: false },
    googleAdsConversionError: { type: String, required: false },
    microsoftAdsOfflineConversionExportedAt: { type: Date, required: false },
    microsoftAdsConversionError: { type: String, required: false },
    brokerId: {
      type: Schema.Types.ObjectId,
      ref: 'BrokerOrg',
      default: null,
    },
    brokerOrderId: {
      type: Schema.Types.ObjectId,
      ref: 'BrokerOrder',
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);


// Add a pre-save hook to clean up empty items and validate data
taskSchema.pre('save', function (next) {
  if (
    this.isNew ||
    this.isModified('email') ||
    this.isModified('excludedFromBusinessList')
  ) {
    this.isBusinessEmail = resolveIsBusinessEmail(
      this.email,
      this.excludedFromBusinessList,
    );
  }

  // Filter out items where both standardItemId is null and object is empty
  this.items = this.items.filter(item => {
    return !(item.standardItemId === null && (!item.object || item.object.trim() === ''));
  });

  // Only derive from click ids on create / when those fields change.
  // Leaves offline stamps (Call CSV, LSA) alone on unrelated saves.
  if (
    this.isNew
    || this.isModified('gclid')
    || this.isModified('gbraid')
    || this.isModified('wbraid')
    || this.isModified('msclkid')
    || this.isModified('fbclid')
    || this.isModified('utm_source')
  ) {
    this.trafficSource = resolveTrafficSource({
      gclid: this.gclid,
      gbraid: this.gbraid,
      wbraid: this.wbraid,
      msclkid: this.msclkid,
      fbclid: this.fbclid,
      utm_source: this.utm_source,
      existingTrafficSource: this.trafficSource,
    });
  }

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
  const $set = update.$set || update;

  if (
    $set.gclid !== undefined
    || $set.gbraid !== undefined
    || $set.wbraid !== undefined
    || $set.msclkid !== undefined
    || $set.fbclid !== undefined
    || $set.utm_source !== undefined
  ) {
    const trafficSource = resolveTrafficSource({
      gclid: $set.gclid,
      gbraid: $set.gbraid,
      wbraid: $set.wbraid,
      msclkid: $set.msclkid,
      fbclid: $set.fbclid,
      utm_source: $set.utm_source,
      existingTrafficSource: $set.trafficSource,
    });
    if (update.$set) {
      update.$set.trafficSource = trafficSource;
    } else {
      update.trafficSource = trafficSource;
    }
  }

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

    // Increase van load once when task transitions to Completed (capacity lives on Van, not Truck/unit)
    if (!this.isNew && this.truckId) {
      const previousTask = await this.constructor.findById(this._id).select('taskStatus').lean();
      const wasCompleted = previousTask?.taskStatus === 'Completed';
      if (!wasCompleted && this.taskStatus === 'Completed') {
        const { usedSpace, perItem } = await resolveTaskVanLoadDetails(this);
        if (usedSpace > 0) {
          const taskDate = this.date.toISOString().split('T')[0];
          const assigned = await getAssignedForDayFromRanges(this.truckId, taskDate);
          const truckRow = await mongoose.model('Truck').findById(this.truckId).select('vanId').lean();
          const vanId = assigned.vanId || truckRow?.vanId;
          if (vanId) {
            const van = await Van.findById(vanId);
            if (van) {
              van.currentCapacity = Number(van.currentCapacity || 0) + usedSpace;
              van.itemsInTruck = Array.isArray(van.itemsInTruck) ? van.itemsInTruck : [];

              for (const entry of perItem) {
                if (!entry?.item || !Number.isFinite(entry.spaceOfVan) || entry.spaceOfVan <= 0) continue;

                const idx = van.itemsInTruck.findIndex((x) => x.item === entry.item);
                if (idx >= 0) {
                  van.itemsInTruck[idx].quantity = Number(van.itemsInTruck[idx].quantity || 0) + Number(entry.quantity || 0);
                  van.itemsInTruck[idx].spaceOfVan = Number(van.itemsInTruck[idx].spaceOfVan || 0) + entry.spaceOfVan;
                } else {
                  van.itemsInTruck.push({
                    item: entry.item,
                    quantity: Number(entry.quantity || 0),
                    spaceOfVan: entry.spaceOfVan,
                  });
                }
              }

              await van.save();
            }
          }
        }
      }
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

taskSchema.pre(['findOneAndUpdate', 'updateOne'], async function (next) {
  try {
    const update = this.getUpdate() || {};
    const $set = update.$set || {};
    const emailInUpdate = $set.email ?? update.email;
    const excludedInUpdate =
      $set.excludedFromBusinessList ?? update.excludedFromBusinessList;

    if (emailInUpdate !== undefined || excludedInUpdate !== undefined) {
      const doc = await this.model
        .findOne(this.getQuery())
        .select('email excludedFromBusinessList')
        .lean();

      const email = emailInUpdate !== undefined ? emailInUpdate : doc?.email;
      const excluded =
        excludedInUpdate !== undefined
          ? excludedInUpdate
          : (doc?.excludedFromBusinessList ?? false);
      const isBusinessEmail = resolveIsBusinessEmail(email, excluded);

      if (update.$set) {
        update.$set.isBusinessEmail = isBusinessEmail;
      } else if (update.$setOnInsert && !update.$set) {
        update.$setOnInsert.isBusinessEmail = isBusinessEmail;
      } else {
        this.setUpdate({
          ...update,
          $set: { ...(update.$set || {}), isBusinessEmail },
        });
      }
    }
    next();
  } catch (error) {
    next(error);
  }
});

taskSchema.index({ createdAt: -1 });
taskSchema.index({ paymentStatus: 1, taskStatus: 1 });
taskSchema.index({ date: 1, createdAt: -1 });
taskSchema.index({ taskStatus: 1, paymentStatus: 1, finishDate: 1 });
taskSchema.index({ isBusinessEmail: 1, createdAt: -1 });

taskSchema.index({ trafficSource: 1, createdAt: -1 });
taskSchema.index({ subsource: 1, createdAt: -1 });
taskSchema.index({ createdByType: 1, createdAt: -1 });
taskSchema.index({ createdByType: 1, paymentStatus: 1, createdAt: -1, trafficSource: 1 });

// findLinkedTaskForQuotation / QuotationRequest.computeStatus: equality on
// quotationId, sort on createdAt, then the paymentStatus $ne range.
taskSchema.index({ quotationId: 1, createdAt: 1, paymentStatus: 1 });
// Narrows the privateNotes regex scan in repeatCustomerSync to MigrationScript rows.
taskSchema.index({ createdBy: 1 });

const Task = mongoose.model("Task", taskSchema);
module.exports = Task;
