const mongoose = require('mongoose');
const { Schema } = mongoose;

const truckSchema = new Schema({
  name: { type: String, required: false }, // unit name (display / lookup)
  vanId: { type: Schema.Types.ObjectId, ref: 'Van', required: false }, // optional until migration; Van holds asset data
  driverId: { type: Schema.Types.ObjectId, ref: 'Driver' },
  helperId: { type: Schema.Types.ObjectId, ref: 'Helper' },
  extraDrivers: [{
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    startDate: { type: Date },
    endDate: { type: Date },
    assignedAt: { type: Date, default: Date.now },
  }],
  extraHelpers: [{
    helperId: { type: Schema.Types.ObjectId, ref: 'Helper', required: true },
    startDate: { type: Date },
    endDate: { type: Date },
    assignedAt: { type: Date, default: Date.now },
  }],
  tasks: {
    type: Map,
    of: [{
      taskId: { type: Schema.Types.ObjectId },
      type: {
        type: String,
        enum: ['task', 'TippingRequest'],
      },
      order: { type: Number, default: 0 }
    }],
    default: new Map(),
    validate: {
      validator: function (tasks) {
        if (!(tasks instanceof Map)) return false;
        for (let [key, value] of tasks) {
          if (typeof key !== 'string' || !Array.isArray(value)) {
            return false;
          }
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
  // Assignment log refs with date (unit assignment history)
  assignmentLogs: [{
    logId: { type: Schema.Types.ObjectId, ref: 'UnitAssignmentLog', required: true },
    at: { type: Date, required: true },
  }],
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
  
  let tasksForDate = this.tasks.get(dateKey) || [];
  // Normalize legacy 'Task' to schema enum 'task' and use new array so Mongoose marks path modified
  const normalized = tasksForDate.map((entry) => ({
    ...entry,
    type: entry.type === 'Task' ? 'task' : entry.type,
  }));
  normalized.push({
    taskId: taskId,
    type: 'task',
    order: order
  });

  // Sort by order
  normalized.sort((a, b) => (a.order || 0) - (b.order || 0));

  this.tasks.set(dateKey, normalized);
  this.markModified('tasks');
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
  this.markModified('tasks');
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
    this.markModified('tasks');
    return true;
  }
  
  return false;
};

const Truck = mongoose.model('Truck', truckSchema);
module.exports = Truck;
