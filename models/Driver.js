// models/Driver.js
const mongoose = require("mongoose");
const { User, userSchema } = require("./User");

// Break schema to store individual break entries
const breakSchema = new mongoose.Schema({
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: false },
  duration: { type: Number, required: false } // Duration in minutes
});

// Driver-specific schema fields
const driverSchema = new mongoose.Schema({
  startTime: { type: Date, required: false },
  endTime: { type: Date, required: false },
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
    currentJobAddress: { type: String, required: false },
    nextJobAddress: { type: String, required: false },
  },
  breaks: [breakSchema], // Array of breaks
});

// Create the Driver model using User as a discriminator
const Driver = User.discriminator("Driver", driverSchema);

module.exports = Driver;
