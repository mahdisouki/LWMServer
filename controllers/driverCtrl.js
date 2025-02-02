const { User } = require('../models/User');
const { Helper } = require('../models/Helper');
const Task = require('../models/Task');
const Truck = require('../models/Truck');
const TruckStatus = require('../models/TruckStatus');
const bcrypt = require('bcrypt');
const Driver = require('../models/Driver');
const { emitNotificationToUser } = require('../socket');
const adminId = "677d414cd9a5d9785cdde97b"
const driverManagement = {
  updateDriverProfile: async (req, res) => {
    const driverId = req.user._id;
    const {
      email,
      officialEmail,
      phoneNumber,
      username,
      gender,
      designation,
      dateOfBirth,
      address,
      CIN,
      password,
    } = req.body;

    try {
      // Find driver by ID
      const driver = await User.findById(driverId);

      if (!driver || !driver.role.includes('Driver')) {
        return res
          .status(404)
          .json({ message: 'Driver not found or user is not a driver' });
      }

      // Update fields only if they are provided
      if (email) driver.email = email;
      if (officialEmail) driver.officialEmail = officialEmail;
      if (phoneNumber)
        driver.phoneNumber = Array.isArray(phoneNumber)
          ? phoneNumber
          : [phoneNumber];
      if (username) driver.username = username;
      if (gender) driver.gender = gender;
      if (designation) driver.designation = designation;
      if (dateOfBirth) driver.dateOfBirth = dateOfBirth;
      if (address) driver.address = address;
      if (CIN) driver.CIN = CIN;

      // Update files if new files are uploaded
      if (req.files) {
        if (req.files.picture) driver.picture = req.files.picture[0].path;
        if (req.files.DriverLicense) driver.DriverLicense = req.files.DriverLicense[0].path;
        if (req.files.addressProof) driver.addressProof = req.files.addressProof[0].path;
        if (req.files.NatInsurance) driver.NatInsurance = req.files.NatInsurance[0].path;
      }

      // Hash and update password if provided
      if (password) {
        driver.password = await bcrypt.hash(password, 10);
      }

      // Save the updated driver data
      await driver.save();

      // Respond with updated information
      res.status(200).json({
        message: 'Driver profile updated successfully',
        user: {
          username: driver.username,
          email: driver.email,
          role: driver.role,
          id: driver._id,
          picture: driver.picture,
          phoneNumber: driver.phoneNumber[0],
          address: driver.address,
          CIN: driver.CIN,
          DriverLicense: driver.DriverLicense,
          addressProof: driver.addressProof,
          NatInsurance: driver.NatInsurance,
        },
      });
    } catch (error) {
      console.error('Error updating driver profile:', error);
      res.status(500).json({
        message: 'Failed to update driver profile',
        error: error.message,
      });
    }
  },

  getHelperLocationForDriver: async (req, res) => {
    const driverId = req.user._id;

    try {
      // Find the truck assigned to this driver
      const truck = await Truck.findOne({ driverId: driverId });

      if (!truck) {
        return res
          .status(404)
          .json({ message: 'No truck found for the given driver.' });
      }

      // Check if a helper is assigned to the truck
      if (!truck.helperId) {
        return res
          .status(404)
          .json({ message: 'No helper assigned to this truck' });
      }

      // Fetch the helper using helperId from the truck
      const helper = await Helper.findById(truck.helperId);
      if (!helper) {
        return res.status(404).json({ message: 'Helper not found' });
      }

      if (!helper.location) {
        return res
          .status(404)
          .json({ message: 'Location for this helper is not set' });
      }

      res.status(200).json({
        message: 'Helper location retrieved successfully',
        location: helper.location,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve helper location',
        error: error.message,
      });
    }
  },

  getTasksForDriver: async (req, res) => {
    const driverId = req.user._id; // ID of the driver from the authenticated request
  
    try {
      // Determine today's date range
      const startOfDay = new Date();
      console.log("startOfDayB:",startOfDay)
      // startOfDay.setHours(0, 0, 0, 0);
      console.log(startOfDay)
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      console.log(endOfDay)
      const formattedDate = startOfDay.toISOString().split('T')[0]; // Format: 'YYYY-MM-DD'
      console.log("formatted date:",formattedDate)
      // Find the truck assigned to the driver
      const truck = await Truck.findOne({ driverId });
  
      if (!truck) {
        return res
          .status(404)
          .json({ message: 'No truck found for the given driver.' });
      }
  
      // Get the task IDs for today's date from `tasksByDate`
      const taskIdsForToday = truck.tasks.get(formattedDate);
      console.log("taskIdsForToday:",taskIdsForToday)
      // Fetch the tasks for the current day
      // const tasks = await Task.find({
      //   _id: { $in: taskIdsForToday }
      // });
         const tasks = await Task.find();
  
      res
        .status(200)
        .json({ message: 'Tasks for today retrieved successfully', tasks });
    } catch (error) {
      console.error('Error retrieving tasks for driver:', error);
      res.status(500).json({
        message: 'Failed to retrieve tasks',
        error: error.message || 'Unknown error occurred',
      });
    }
  },
  

  updateTruckStart: async (req, res) => {
    const { truckId } = req.params;
    const { fuelLevel, mileageStart } = req.body;
    const uploads = req.files.map((file) => file.path); // Chemins d'accès des images stockées par Cloudinary

    try {
      const statusUpdate = {
        truckId,
        pictureBefore: uploads,
        fuelLevel,
        mileageStart,
      };

      const truckStatus = await TruckStatus.findOneAndUpdate(
        { truckId },
        statusUpdate,
        { new: true, upsert: true }, // Crée un nouveau document si aucun n'existe
      );

      res.status(200).json({
        message: 'Truck start status updated successfully',
        truckStatus,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update truck start status',
        error: error.message,
      });
    }
  },

  updateTruckEnd: async (req, res) => {
    const { truckId } = req.params;
    const { fuelLevelBefore, fuelLevelAfter, mileageEnd } = req.body;
    const uploads = req.files.map((file) => file.path); // Chemins d'accès des images stockées par Cloudinary

    try {
      const statusUpdate = {
        truckId,
        pictureAfter: uploads,
        fuelLevelBefore,
        fuelLevelAfter,
        mileageEnd,
      };

      const truckStatus = await TruckStatus.findOneAndUpdate(
        { truckId },
        statusUpdate,
        { new: true },
      );

      res.status(200).json({
        message: 'Truck end status updated successfully',
        truckStatus,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update truck end status',
        error: error.message,
      });
    }
  },

  uploadInitialConditionPhotos : async (req, res) => {
    const { taskId } = req.params;
    const description = req.body.description;
    const uploads = req.files.map((file) => file.path);

    try {
        // Fetch the truck containing the task
        const truck = await Truck.findOne().populate('tasks');
        if (!truck) {
            return res.status(404).json({ message: 'No truck found for the given task.' });
        }

        // Find the date key that contains the task
        let taskDate = null;

        for (const [date, tasks] of truck.tasks.entries()) {
            if (tasks.some(task => task.equals(taskId))) {
                taskDate = date;
                break;
            }
        }

        if (!taskDate) {
            return res.status(404).json({ message: 'Task not found in the truck.' });
        }

        // Get the current job (task)
        const currentTask = await Task.findById(taskId);
        if (!currentTask) {
            return res.status(404).json({ message: 'Current task not found.' });
        }

        // Find the index of the current task in the tasks array for the date
        const currentTaskIndex = truck.tasks.get(taskDate).findIndex(task => task.equals(taskId));
        let nextJobAddress = null;
        
        // Determine the address of the next job (if any)
        if (currentTaskIndex >= 0 && currentTaskIndex < truck.tasks.get(taskDate).length - 1) {
            const nextTask = await Task.findById(truck.tasks.get(taskDate)[currentTaskIndex + 1]);
            nextJobAddress = nextTask && nextTask.location ? nextTask.location.address : null;
        }

        // Update the task with initial condition photos
        const taskUpdate = {
            $push: {
                initialConditionPhotos: {
                    items: uploads,
                    description: description,
                },
            },
        };

        const updatedTask = await Task.findByIdAndUpdate(taskId, taskUpdate, { new: true });
        if (!updatedTask) {
            return res.status(404).json({ message: 'Failed to update the task with initial condition photos.' });
        }

        // Update the driver's current and next job addresses
        const driverId = truck.driverId;
        if (driverId) {
            const driverUpdate = {
                currentJobAddress: currentTask.location ? currentTask.location.address : null,
                nextJobAddress: nextJobAddress,
            };

            await Driver.findByIdAndUpdate(driverId, driverUpdate, { new: true });
        } else {
            console.warn('No driver assigned to this truck.');
        }

        // Send response
        res.status(200).json({
            message: 'Initial condition photos uploaded successfully',
            task: updatedTask,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Failed to upload initial condition photos',
            error: error.message,
        });
    }
},

  intermediateConditionPhotos: async (req, res) => {
    const { taskId } = req.params;
    const description = req.body.description; // Single description for all uploaded files
    const uploads = req.files.map((file) => file.path); // Collecting file paths

    try {
      // Fetch the truck associated with the current driver
      const truck = await Truck.findOne({ tasks: taskId }).populate('tasks');
      if (!truck) {
        return res
          .status(404)
          .json({ message: 'No truck found for the given task.' });
      }

      // Get the current job (task)
      const currentTask = await Task.findById(taskId);
      if (!currentTask) {
        return res.status(404).json({ message: 'Current task not found.' });
      }

      // Get the next job (next task in the list)
      const currentTaskIndex = truck.tasks.indexOf(taskId);
      let nextJobAddress = null;

      if (currentTaskIndex >= 0 && currentTaskIndex < truck.tasks.length - 1) {
        const nextTask = await Task.findById(truck.tasks[currentTaskIndex + 1]);
        nextJobAddress = nextTask ? nextTask.currentJobAddress : null;
      }

      // Update the task with initial condition photos
      const taskUpdate = {
        intermediateConditionPhotos: [
          {
            items: uploads,
            description: description,
          },
        ],
      };

      const task = await Task.findByIdAndUpdate(
        taskId,
        taskUpdate,
        { new: true }, // Update the task document
      );

      // Update the driver's current and next job addresses
      const driverId = truck.driverId; // Assuming you can get driverId from the truck
      const driverUpdate = {
        currentJobAddress: currentTask.currentJobAddress, // Current task address
        nextJobAddress: nextJobAddress, // Next task address
      };

      await Driver.findByIdAndUpdate(driverId, driverUpdate, { new: true }); // Update the driver document

      res.status(200).json({
        message: 'Initial condition photos uploaded successfully',
        task,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to upload initial condition photos',
        error: error.message,
      });
    }
  },

  uploadFinalConditionPhotos: async (req, res) => {
    const { taskId } = req.params;
    const description = req.body.description;
    const uploads = req.files.map((file) => file.path);

    // console.log(uploads);

    try {
      const taskUpdate = {
        finalConditionPhotos: [
          {
            items: uploads, // This should be an array of strings
            description: description,
          },
        ],
      };

      const task = await Task.findByIdAndUpdate(taskId, taskUpdate, {
        new: true,
      });

      res.status(200).json({
        message: 'Final condition photos uploaded successfully',
        task,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to upload final condition photos',
        error: error.message,
      });
    }
  },

  addAdditionalItems: async (req, res) => {
    const { taskId } = req.params; // Ensure your route is set to capture this

    const description = req.body.description; // Single description for all uploads
    const uploads = req.files.map((file) => file.path); // Array of image URLs
    try {
      const taskUpdate = {
        additionalItems: [
          {
            items: uploads,
            description: description,
          },
        ],
      };

      const task = await Task.findByIdAndUpdate(
        taskId,
        taskUpdate,
        { new: true }, // Ensures the updated document is returned
      );

      res
        .status(200)
        .json({ message: 'Additional items added successfully', task });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to add additional items',
        error: error.message,
      });
    }
  },

  updateJobStatus: async (req, res) => {
    const { taskId } = req.params;
    const { taskStatus } = req.body; // Assuming the new status is passed in the body of the request

    try {
      const task = await Task.findById(taskId);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      // Update the task status
      task.taskStatus = taskStatus;
      await task.save();
      res
        .status(200)
        .json({ message: 'Task status updated successfully', task });
    } catch (error) {
      console.error('Error updating task status:', error);
      res.status(500).json({
        message: 'Failed to update task status',
        error: error.message,
      });
    }
  },

  rateTask: async (req, res) => {
    const { taskId } = req.params;
    const { clientFeedback, clientFeedbackScale } = req.body; // Assuming satisfaction rating and feedback are sent in the body

    try {
      const task = await Task.findById(taskId);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }
      // Update task with the client satisfaction rating and feedback
      task.clientFeedback = clientFeedback;
      task.clientFeedbackScale = clientFeedbackScale;
      task.taskStatus = "Completed"
      await task.save();
      res.status(200).json({ message: 'Task rated successfully', task });
    } catch (error) {
      console.error('Error rating task:', error);
      res
        .status(500)
        .json({ message: 'Failed to rate task', error: error.message });
    }
  },

  markDayStart: async (req, res) => {
    const { userId: id, userType } = req.body;

    try {
      let user;

      if (userType === 'Driver') {
        user = await Driver.findOneAndUpdate(
          { _id: id, role: 'Driver' },
          { startTime: new Date() },
          { new: true },
        );
      } else if (userType === 'Helper') {
        user = await Helper.findOneAndUpdate(
          { _id: id, role: 'Helper' },
          { startTime: new Date() },
          { new: true },
        );
      } else {
        return res.status(400).json({ message: 'Invalid user type' });
      }

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      console.log('azeazeaz', user);
      return res.status(200).json({ message: 'Start time updated', user });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: 'An error occurred', error });
    }
  },
  startBreak: async (req, res) => {
    const driverId = req.user._id;

    try {
      const driver = await Driver.findById(driverId);
      if (!driver) {
        return res.status(404).json({ message: 'Driver not found' });
      }

      // Check if there's an active break
      const activeBreak = driver.breaks.find((b) => !b.endTime);
      if (activeBreak) {
        return res
          .status(400)
          .json({ message: 'Driver is already on a break' });
      }

      // Create a new break entry
      const newBreak = { startTime: new Date() };
      driver.breaks.push(newBreak);
     driver.onBreak = true;
      driver.breakStartTime = Date.now();
      await driver.save();
      emitNotificationToUser(adminId , `a driver ${driver.username} is taking a break`)
      return res.status(200).json({ message: 'Break started', newBreak });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: 'Error starting break', error });
    }
  },

  endBreak: async (req, res) => {
    const driverId = req.user._id;

    try {
      const driver = await Driver.findById(driverId);
      if (!driver || driver.breaks.length === 0) {
        return res
          .status(404)
          .json({ message: 'Driver not found or no active breaks' });
      }

      // Get the last break and update it
      const lastBreak = driver.breaks[driver.breaks.length - 1];
      if (lastBreak.endTime) {
        return res.status(400).json({ message: 'Break already ended' });
      }

      lastBreak.endTime = new Date();
      // Calculate duration in minutes
      lastBreak.duration = Math.round(
        (lastBreak.endTime - lastBreak.startTime) / (1000 * 60),
      );
     driver.onBreak = false;
      await driver.save();

      return res.status(200).json({ message: 'Break ended', lastBreak });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: 'Error ending break', error });
    }
  },

  getBreakTimer: async (req, res) => {
    const driverId = req.user._id;

    try {
      const driver = await User.findById(driverId);
      if (!driver) {
        return res.status(404).json({ message: 'Driver not found' });
      }

      // Check if driver.breaks exists and is not empty
      if (!driver.breaks || driver.breaks.length === 0) {
        return res
          .status(200)
          .json({ message: 'No breaks found', isActive: false, elapsed: 0 });
      }

      // Get the last break and calculate the elapsed time
      const lastBreak = driver.breaks[driver.breaks.length - 1];

      // If lastBreak is active (no endTime)
      if (!lastBreak.endTime) {
        const now = new Date();
        const elapsedMilliseconds = now - lastBreak.startTime;
        const elapsedSeconds = Math.floor(elapsedMilliseconds / 1000);
        return res.status(200).json({
          message: 'Break timer',
          isActive: true,
          elapsed: elapsedSeconds,
        });
      }

      return res
        .status(200)
        .json({ message: 'No active break', isActive: false, elapsed: 0 });
    } catch (error) {
      console.error(error);
      return res
        .status(500)
        .json({ message: 'Error getting break timer', error });
    }
  },
};

module.exports = driverManagement;
