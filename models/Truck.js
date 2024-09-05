const mongoose = require('mongoose');
const { Schema } = mongoose;

const truckSchema = new Schema({
  driverId: { type: Schema.Types.ObjectId, ref: 'Driver' },  
  helperId: { type: Schema.Types.ObjectId, ref: 'Helper'}, 
  tasks: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
  name: { type: String, required: true, unique: true },
  loadCapacity:{ type:  Number},
  matricule: { type: String, required: true, unique: true },
});

const Truck = mongoose.model('Truck', truckSchema);
module.exports = Truck;
