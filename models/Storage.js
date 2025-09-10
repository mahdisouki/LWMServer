// models/Storage.js
const mongoose = require("mongoose");
const { Schema } = mongoose;
const StoragePlace = require("./StroragePlace");

const storageSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", required: true },
    helperId: { type: Schema.Types.ObjectId, ref: "Helper", required: true },
    truckId: { type: Schema.Types.ObjectId, ref: "Truck", required: true },
    date: { type: Date, required: true },
    type: { type: String, enum: ["take", "add"] },
    items: {
      fridges: { type: Number, default: 0 },
      mattresses: { type: Number, default: 0 },
      sofas: { type: Number, default: 0 },
      paint: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },
    proofs: [{ type: String }],
    notes: { type: String },
    storagePlace: { type: Schema.Types.ObjectId, ref: "StoragePlace" },
    isReset: { type: Boolean, default: false }, // Flag to distinguish historical vs new records for rubbish quantity calculations
  },
  { timestamps: true }
);

// Ensure default storage place is set to the local one when not provided
storageSchema.pre("validate", async function (next) {
  try {
    if (!this.storagePlace) {
      let localPlace = await StoragePlace.findOne({ name: /^local$/i });

      // If no local storage place exists, create one
      if (!localPlace) {
        localPlace = new StoragePlace({
          name: "Local",
          address: "Local Storage ",
          location: {
            latitude: 51.5074, // London coordinates as default
            longitude: -0.1278
          },
          capacity: 1000,
          availableCapacity: 1000
        });
        await localPlace.save();
      }

      this.storagePlace = localPlace._id;
    }
    next();
  } catch (err) {
    next(err);
  }
});

const Storage = mongoose.model("Storage", storageSchema);
module.exports = Storage;
