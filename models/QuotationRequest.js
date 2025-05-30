const mongoose = require('mongoose');
const { Schema } = mongoose;

const quotationRequestSchema = new Schema({
  Name: {type:String , required: true }, 
  line1: { type: String, required: true },
  line2: { type: String, required: true },
  email: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  Town: { type: String},
  postcode: { type: Number, required: true },
  estimatedPrices : [{name:{type:String} , price:{type:String}}],
  comments: { type: String, required: false },
  items: [{ type: String, required: true }], 
  createdAt: { type: Date, default: Date.now }
});

const QuotationRequest = mongoose.model('QuotationRequest', quotationRequestSchema);
module.exports = QuotationRequest;
