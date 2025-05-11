// models/Storage.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const storagePlaceSchema = new Schema(
  {
   name: { type: String, required: true },
   address: { type: String, required: true },
   location:{
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true }
   },
   image: { type: String,  },
   capacity: { type: Number,  },
   availableCapacity: { type: Number,  },
   
   

  },
  { timestamps: true }
);

const StoragePlace = mongoose.model("StoragePlace", storagePlaceSchema);
module.exports = StoragePlace;
