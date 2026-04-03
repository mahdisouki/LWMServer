const mongoose = require('mongoose');
const { Schema } = mongoose;

const fuelSchema = new Schema(
  {
    driverId: {
      type: Schema.Types.ObjectId,
      ref: 'Driver',
      required: true,
    },
    dailySheetId: {
      type: Schema.Types.ObjectId,
      ref: 'DailySheet',
      required: false,
    },
    amount: { type: Number, required: true },
    litres: { type: Number },
    time: { type: Date, default: Date.now },
    station: { type: String },
    addedBy: { type: String },
    date: { type: Date, default: Date.now },
    linkedToDailySheet: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const Fuel = mongoose.model('Fuel', fuelSchema);
module.exports = Fuel;
