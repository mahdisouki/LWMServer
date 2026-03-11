const mongoose = require('mongoose');
const { Schema } = mongoose;
const vanSchema = new Schema({
  matricule: { type: String, required: true,  },
  fuelNumber: { type: String, required: true,  },
  fuelLevel: { type: Number, default: null },           // e.g. percentage or litres; null = unknown
  loadCapacity: { type: Number },
  vanHire: { type: Number, default: 0 },
  insurance: { type: Number, default: 0 },
}, { timestamps: true });
const Van = mongoose.model('Van', vanSchema);
module.exports = Van;