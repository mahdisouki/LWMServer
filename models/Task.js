const mongoose = require("mongoose");
const { Schema } = mongoose;

const taskSchema = new Schema({
  clientId: { type: Schema.Types.ObjectId, ref: "Client", required: false }, 
  truckId: { type: Schema.Types.ObjectId, ref: "Truck", required: false },
  firstName:{ type: String, required: true },
  lastName:{ type: String, required: true },
  phoneNumber:{ type: String, required: true },
  clientObjectPhotos: [{ type: String, required: true }],
  initialConditionPhotos: [{
    items: [{ type: String }], // Array of URLs for initial condition photos
    description: { type: String } // Single description for all initial condition photos
  }],
  finalConditionPhotos: [{
    items: [{ type: String }], // Array of URLs for final condition photos
    description: { type: String } // Single description for all final condition photos
  }],
  additionalItems: [{
    items: [{ type: String }], // Array of additional item names
    description: { type: String } // Single description for these additional items
  }],
  location: { type: String, required: true },
  date: { type: Date, required: true },
  hour: { type: String, required: true },
  object: { type: String, required: true },
  price: { type: Number, required: true },
  paymentStatus: {
    type: String,
    enum: ["Paid", "Unpaid", "Pending"],
    default: "Pending"
  },
  taskStatus: {
    type: String,
    enum: ["Declined", "Processing", "Completed"],
    default: "Processing"
  },
  additionalNotes: { type: String, required: false },
  itemDescription: { type: String, required: false },
  clientFeedback: { type: String },
}, { timestamps: true });

const Task = mongoose.model("Task", taskSchema);
module.exports = Task;
