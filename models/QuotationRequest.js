const mongoose = require('mongoose');
const { Schema } = mongoose;

const quotationRequestSchema = new Schema({
  Name: {type:String , required: true }, 
  DoorNumber: { type: String, required: true },
  RoadName: { type: String, },
  email: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  Town: { type: String},
  postcode: { type: String, required: true },
  estimatedPrices : [{name:{type:String} , price:{type:String}}],
  comments: { type: String, required: false },
  items: [{ type: String, required: true }], 
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const QuotationRequest = mongoose.model('QuotationRequest', quotationRequestSchema);
module.exports = QuotationRequest;
