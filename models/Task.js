const mongoose = require("mongoose");
const { Schema } = mongoose;
const StandardItem = require('../models/StandardItem'); // Ajustez le chemin si nécessaire
const Counter = require('./Counter');

const taskSchema = new Schema(
  {
    orderNumber: { type: String, unique: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: false },
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
      enum: ["partial_Paid","Paid","partial_Refunded", "refunded", "Unpaid"],
      default: "Unpaid",
    },
    taskStatus: {
      type: String,
      enum: ["Declined", "Processing", "Completed"],
      default: "Processing",
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
      enum: ["BankTransfer", "payment_link", "online"],
    }
    },
    remainingAmount: { type: Number },

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

const Task = mongoose.model("Task", taskSchema);
module.exports = Task;
