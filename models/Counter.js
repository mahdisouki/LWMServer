const mongoose = require('mongoose');
const { Schema } = mongoose;

const counterSchema = new Schema({
  _id: { type: String, required: true },
  sequence_value: { type: Number, default: 0 }
});

const Counter = mongoose.model('Counter', counterSchema);

module.exports = Counter; 