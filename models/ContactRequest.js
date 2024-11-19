// models/ContactRequest.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const contactRequestSchema = new Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const ContactRequest = mongoose.model('ContactRequest', contactRequestSchema);
module.exports = ContactRequest;
