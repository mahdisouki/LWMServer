const mongoose = require("mongoose");
const { Schema } = mongoose;

const taskSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: false },
    truckId: { type: Schema.Types.ObjectId, ref: "Truck", required: false },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    phoneNumber2: { type: String },
    clientObjectPhotos: [{ type: String, required: true }],
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
      type:String,
      enum: ["AnyTime", "7am-12pm", "12pm-5pm"],
      default:"AnyTime"
    },
    Objectsposition: { 
      type:String,
      enum: ["Inside", "Outside", "insideWithDismantling"],
      default:"Outside"
    },
    object: { type: String, required: true },
    price: { type: Number, required: true },
    paymentStatus: {
      type: String,
      enum: ["Paid", "Unpaid", "Pending"],
      default: "Pending",
    },
    taskStatus: {
      type: String,
      enum: ["Created","Declined", "Processing", "Completed"],
      default: "Created",
    },
    email:{type:String},
    additionalNotes: { type: String, required: false },
    itemDescription: { type: String, required: false },
    clientFeedback: { type: String },
    clientFeedbackScale: { type: Number },
    startDate: { type: Date },
    finishDate: { type: Date },
    timeSpent: { type: Number },
  },
  { timestamps: true }
);

const Task = mongoose.model("Task", taskSchema);
module.exports = Task;
