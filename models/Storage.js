// models/Storage.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const storageSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", required: true },
    date: { type: Date, required: true },
    type:{type:String , enum:["take" , "add"]},
    items: {
      fridges: { type: Number, default: 0 },
      mattresses: { type: Number, default: 0 },
      sofas: { type: Number, default: 0 },
      paint: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },
    proofs:[{type:String}],
    notes: { type: String }, 
  },
  { timestamps: true }
);

const Storage = mongoose.model("Storage", storageSchema);
module.exports = Storage;
