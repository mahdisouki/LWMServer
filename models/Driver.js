// models/Driver.js
const mongoose = require("mongoose");
const { User, userSchema } = require("./User");

// Driver-specific schema fields
const driverSchema = new mongoose.Schema({
  startTime: { type: Date, required: false },
  endTime: { type: Date, required: false },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      required: false,
    },
    coordinates: {
      type: [Number],
      required: false,
    },
    currentJobAddress: { type: String, required: false }, // Current job address
    nextJobAddress: { type: String, required: false }, // Next job address
  }
});

const Driver = User.discriminator("Driver", driverSchema);

module.exports = Driver;
