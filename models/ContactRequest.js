// models/ContactRequest.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const contactRequestSchema = new Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const ContactRequest = mongoose.model('ContactRequest', contactRequestSchema);
module.exports = ContactRequest;
