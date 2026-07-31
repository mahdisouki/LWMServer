// models/MovingServiceRequest.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const movingServiceRequestSchema = new Schema({
  fullName: { type: String, required: true },
  contactNumber: { type: String, required: true },
  email: { type: String, required: true },
  pickUpLocation: { type: String, required: true },
  dropOffLocation: { type: String, required: true },
  pickUpPropertyType: { type: String, required: false },
  dropOffPropertyType: { type: String, required: false },
  packingRequired: { type: String, required: false },
  accessInfo: { type: String, required: false },
  extraInfo: { type: String, required: false },
  files: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
});

const MovingServiceRequest = mongoose.model('MovingServiceRequest', movingServiceRequestSchema);
module.exports = MovingServiceRequest;
