const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  body: {
    type: String,
    required: true
  },
  variables: {
    type: [String],
    default: []
  }
}, { timestamps: true });

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);
