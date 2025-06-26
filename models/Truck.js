const mongoose = require('mongoose');
const { Schema } = mongoose;

const truckSchema = new Schema({
  driverId:  { type: Schema.Types.ObjectId, ref: 'Driver' },
  driverSpecificDays:{
    startDate:{type:Date },
    endDate:{type:Date },
  },
  helperId: { type: Schema.Types.ObjectId, ref: 'Helper'}, 
  helperSpecificDays:{
    startDate:{type:Date },
    endDate:{type:Date },
  } ,
  tasks: {
    type: Map,
    of: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
    default: new Map(),
    validate: {
      validator: function(tasks) {
        // Validate that all entries are proper Map entries
        if (!(tasks instanceof Map)) return false;
        for (let [key, value] of tasks) {
          if (typeof key !== 'string' || !Array.isArray(value)) {
            return false;
          }
        }
        return true;
      },
      message: 'Tasks must be a valid Map with string keys and array values'
    }
  },
  name: { type: String, required: true, unique: true },
  loadCapacity:{ type:  Number},
  matricule: { type: String, required: true, unique: true },
  fuelNumber: { type: String, required: true, unique: true },
});

// Static method to clean up corrupted tasks data
truckSchema.statics.cleanupTasks = async function() {
  try {
    console.log('Cleaning up corrupted tasks data in trucks...');
    
    const trucks = await this.find({});
    let cleanedCount = 0;
    
    for (const truck of trucks) {
      let needsUpdate = false;
      
      // Check if tasks is corrupted
      if (truck.tasks && !(truck.tasks instanceof Map)) {
        console.log(`Fixing corrupted tasks for truck ${truck._id}`);
        truck.tasks = new Map();
        needsUpdate = true;
        cleanedCount++;
      }
      
      if (needsUpdate) {
        await truck.save();
      }
    }
    
    console.log(`Cleaned up tasks for ${cleanedCount} trucks`);
    return cleanedCount;
  } catch (error) {
    console.error('Error cleaning up truck tasks:', error);
    throw error;
  }
};

const Truck = mongoose.model('Truck', truckSchema);
module.exports = Truck;
