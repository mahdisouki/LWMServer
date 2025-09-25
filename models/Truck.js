const mongoose = require('mongoose');
const { Schema } = mongoose;

const truckSchema = new Schema({
  driverId: { type: Schema.Types.ObjectId, ref: 'Driver' },
  driverSpecificDays: {
    startDate: { type: Date },
    endDate: { type: Date },
  },
  helperId: { type: Schema.Types.ObjectId, ref: 'Helper' },
  helperSpecificDays: {
    startDate: { type: Date },
    endDate: { type: Date },
  },
  tasks: {
    type: Map,
    of: [{
      taskId: { type: Schema.Types.ObjectId },
      type: { 
        type: String, 
        enum: ['Task', 'TippingRequest'], 
       
      },
      order: { type: Number, default: 0 }
    }],
    default: new Map(),
    validate: {
      validator: function (tasks) {
        // Validate that all entries are proper Map entries
        if (!(tasks instanceof Map)) return false;
        for (let [key, value] of tasks) {
          if (typeof key !== 'string' || !Array.isArray(value)) {
            return false;
          }
          // Validate each item in the array
          for (let item of value) {
            if (!item.taskId || !item.type) {
              return false;
            }
          }
        }
        return true;
      },
      message: 'Tasks must be a valid Map with string keys and array values containing {taskId, type, order} objects'
    }
  },
  name: { type: String, required: true, unique: true },
  loadCapacity: { type: Number },
  matricule: { type: String, required: true, unique: true },
  fuelNumber: { type: String, required: true, unique: true },
});

// Static method to clean up corrupted tasks data
truckSchema.statics.cleanupTasks = async function () {
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

// Instance method to add a task to a specific date
truckSchema.methods.addTask = function(date, taskId, order = 0) {
  if (!this.tasks) {
    this.tasks = new Map();
  }
  
  const dateKey = date;
  if (!this.tasks.has(dateKey)) {
    this.tasks.set(dateKey, []);
  }
  
  const tasksForDate = this.tasks.get(dateKey);
  tasksForDate.push({
    taskId: taskId,
    type: 'Task',
    order: order
  });
  
  // Sort by order
  tasksForDate.sort((a, b) => a.order - b.order);
  
  this.tasks.set(dateKey, tasksForDate);
};

// Instance method to add a tipping request to a specific date
truckSchema.methods.addTippingRequest = function(date, tippingRequestId, order = 0) {
  if (!this.tasks) {
    this.tasks = new Map();
  }
  
  const dateKey = date;
  if (!this.tasks.has(dateKey)) {
    this.tasks.set(dateKey, []);
  }
  
  const tasksForDate = this.tasks.get(dateKey);
  tasksForDate.push({
    taskId: tippingRequestId,
    type: 'TippingRequest',
    order: order
  });
  
  // Sort by order
  tasksForDate.sort((a, b) => a.order - b.order);
  
  this.tasks.set(dateKey, tasksForDate);
};

// Instance method to get all tasks and tipping requests for a date with proper ordering
truckSchema.methods.getTasksForDate = function(date) {
  if (!this.tasks || !this.tasks.has(date)) {
    return [];
  }
  
  const tasksForDate = this.tasks.get(date);
  // Sort by order to maintain the sequence
  return tasksForDate.sort((a, b) => a.order - b.order);
};

// Instance method to update the order of tasks/tipping requests
truckSchema.methods.updateTaskOrder = function(date, taskId, newOrder) {
  if (!this.tasks || !this.tasks.has(date)) {
    return false;
  }
  
  const tasksForDate = this.tasks.get(date);
  const taskIndex = tasksForDate.findIndex(task => task.taskId.toString() === taskId.toString());
  
  if (taskIndex !== -1) {
    tasksForDate[taskIndex].order = newOrder;
    // Sort by order
    tasksForDate.sort((a, b) => a.order - b.order);
    this.tasks.set(date, tasksForDate);
    return true;
  }
  
  return false;
};

const Truck = mongoose.model('Truck', truckSchema);
module.exports = Truck;
