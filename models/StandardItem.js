const mongoose = require('mongoose');

const standardItemSchema = new mongoose.Schema({
  itemName: { type: String, required: true },
  image: { type: String, required: true },
  images: [{ type: String }],
  price: { type: Number, required: true },
  isHidden: { type: Boolean, default: false },
  category: [{ type: mongoose.Types.ObjectId, ref: "serviceCategory" }],
  description: { type: String, required: false },
  insidePrice: { type: Number, required: false },
  insideWithDismantlingPrice: { type: Number, required: false },
  Objectsposition: {
    type: String,
    enum: ["Inside", "Outside", "InsideWithDismantling"],
    default: "Outside",
  },
  ewcCode: { type: String, required: false },
  spaceOfVan: { type: Number, required: false },
  timespentOutside: { type: Number, required: false },
  timespentInside: { type: Number, required: false },
  timespentInsdiewithDis: { type: Number, required: false }
});

const StandardItem = mongoose.model('StandardItem', standardItemSchema);
module.exports = StandardItem;
