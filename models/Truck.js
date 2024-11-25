const mongoose = require('mongoose');
const { Schema } = mongoose;

const truckSchema = new Schema({
  driverId:  { type: Schema.Types.ObjectId, ref: 'Driver' },
  driverSpecificDays:{
    startDate:{type:Date },
    endDate:{type:Date },
  } ,
  helperId: { type: Schema.Types.ObjectId, ref: 'Helper'}, 
  helperSpecificDays:{
    startDate:{type:Date },
    endDate:{type:Date },
  } ,
  tasks: {
    type: Map, // Using a Map to organize tasks by date
    of: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
    default: {},
  },  name: { type: String, required: true, unique: true },
  loadCapacity:{ type:  Number},
  matricule: { type: String, required: true, unique: true },
});

const Truck = mongoose.model('Truck', truckSchema);
module.exports = Truck;
