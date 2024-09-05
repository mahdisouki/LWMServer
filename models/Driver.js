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
      required: true,
    },
    coordinates: {
      type: [Number],
      required: true,
    },
  }
});

const Driver = User.discriminator("Driver", driverSchema);

module.exports = Driver;
