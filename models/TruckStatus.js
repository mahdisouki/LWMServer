const mongoose = require('mongoose');
const { Schema } = mongoose;

const truckStatusSchema = new Schema({
    truckId: { type: Schema.Types.ObjectId, ref: "Truck", required: true },
  
  pictureBefore: [{ type: String }], 
  pictureAfter: [{ type: String }], 
  fuelLevel: { type: Number, required: true } ,
  mileageStart: { type: Number },
  mileageEnd: { type: Number },
  conditionReport: { type: String },
});



const TruckStatus = mongoose.model('TruckStatus', truckStatusSchema);

module.exports = TruckStatus;