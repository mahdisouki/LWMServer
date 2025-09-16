const { User } = require('../models/User');
const { Helper } = require('../models/Helper');
const Task = require('../models/Task');
const Truck = require('../models/Truck');
const TruckStatus = require('../models/TruckStatus');
const bcrypt = require('bcrypt');
const Driver = require('../models/Driver');
const { emitNotificationToUser } = require('../socket');
const sendReviewRequestEmail = require('../utils/sendReviewEmail');
const adminId = "67cb6810c9e768ec25d39523"

function getTodayDateRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// Helper function to get user model based on role
async function getUserModel(userId) {
  // Try to find user in User model first
  let user = await User.findById(userId);
  if (user) {
    if (user.role.includes('Driver')) {
      return { user, model: 'User', type: 'Driver' };
    } else if (user.role.includes('Helper')) {
      return { user, model: 'User', type: 'Helper' };
    }
  }

  // If not found in User model, try Driver model
  user = await Driver.findById(userId);
  if (user) {
    return { user, model: 'Driver', type: 'Driver' };
  }

  // If not found in Driver model, try Helper model
  user = await Helper.findById(userId);
  if (user) {
    return { user, model: 'Helper', type: 'Helper' };
  }

  return null;
}

// Helper function to get truck for user (driver or helper)
async function getTruckForUser(userId) {
  // First try to find truck by driverId
  let truck = await Truck.findOne({ driverId: userId });
  if (truck) {
    return truck;
  }

  // If not found, try to find truck by helperId
  truck = await Truck.findOne({ helperId: userId });
  if (truck) {
    return truck;
  }

  return null;
}

const driverManagement = {
  updateDriverProfile: async (req, res) => {
    const userId = req.user._id;
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
      // Get user model and type
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found or not authorized' });
      }

      const { user, model, type } = userInfo;

      // Update fields only if they are provided
      if (email) user.email = email;
      if (officialEmail) user.officialEmail = officialEmail;
      if (phoneNumber)
        user.phoneNumber = Array.isArray(phoneNumber)
          ? phoneNumber
          : [phoneNumber];
      if (username) user.username = username;
      if (gender) user.gender = gender;
      if (designation) user.designation = designation;
      if (dateOfBirth) user.dateOfBirth = dateOfBirth;
      if (address) user.address = address;
      if (CIN) user.CIN = CIN;

      // Update files if new files are uploaded
      if (req.files) {
        if (req.files.picture) user.picture = req.files.picture[0].path;
        if (req.files.DriverLicense) user.DriverLicense = req.files.DriverLicense[0].path;
        if (req.files.addressProof) user.addressProof = req.files.addressProof[0].path;
        if (req.files.NatInsurance) user.NatInsurance = req.files.NatInsurance[0].path;
      }

      // Hash and update password if provided
      if (password) {
        user.password = await bcrypt.hash(password, 10);
      }

      // Save the updated user data
      await user.save();

      // Respond with updated information
      res.status(200).json({
        message: `${type} profile updated successfully`,
        user: {
          username: user.username,
          email: user.email,
          role: user.role || type,
          id: user._id,
          picture: user.picture,
          phoneNumber: user.phoneNumber[0],
          address: user.address,
          CIN: user.CIN,
          DriverLicense: user.DriverLicense,
          addressProof: user.addressProof,
          NatInsurance: user.NatInsurance,
        },
      });
    } catch (error) {
      console.error('Error updating user profile:', error);
      res.status(500).json({
        message: 'Failed to update user profile',
        error: error.message,
      });
    }
  },

  getHelperLocationForDriver: async (req, res) => {
    const userId = req.user._id;
    console.log("userId:", userId)
    try {
      // Get user info to determine if they're a driver or helper
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { type } = userInfo;

      // Find the truck for this user
      const truck = await getTruckForUser(userId);

      if (!truck) {
        return res
          .status(404)
          .json({ message: 'No truck found for the given user.' });
      }

      // If user is a driver, get helper location
      if (type === 'Driver') {
        if (!truck.helperId) {
          return res
            .status(404)
            .json({ message: 'No helper assigned to this truck' });
        }

        const helper = await User.findById(truck.helperId);
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
      }
      // If user is a helper, get driver location
      else if (type === 'Helper') {
        if (!truck.driverId) {
          return res
            .status(404)
            .json({ message: 'No driver assigned to this truck' });
        }

        const driver = await Driver.findById(truck.driverId);
        if (!driver) {
          return res.status(404).json({ message: 'Driver not found' });
        }

        if (!driver.location) {
          return res
            .status(404)
            .json({ message: 'Location for this driver is not set' });
        }

        res.status(200).json({
          message: 'Driver location retrieved successfully',
          location: driver.location,
        });
      }
    } catch (error) {
      console.log("error:", error)
      res.status(500).json({
        message: 'Failed to retrieve location',
        error: error.message,
      });
    }
  },

  getHelperInfoForDriver: async (req, res) => {
    const userId = req.user._id;

    try {
      // Get user info to determine if they're a driver or helper
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { type } = userInfo;

      // Find the truck for this user
      const truck = await getTruckForUser(userId);

      if (!truck) {
        return res
          .status(404)
          .json({ message: 'No truck found for the given user.' });
      }

      // If user is a driver, get helper info
      if (type === 'Driver') {
        if (!truck.helperId) {
          return res
            .status(404)
            .json({ message: 'No helper assigned to this truck' });
        }

        const helper = await User.findById(truck.helperId);
        if (!helper) {
          return res.status(404).json({ message: 'Helper not found' });
        }

        res.status(200).json({
          message: 'Helper information retrieved successfully',
          helperInfo: {
            name: helper.username,
            phoneNumber: helper.phoneNumber || '',
            address: helper.address || ''
          }
        });
      }
      // If user is a helper, get driver info
      else if (type === 'Helper') {
        if (!truck.driverId) {
          return res
            .status(404)
            .json({ message: 'No driver assigned to this truck' });
        }

        const driver = await Driver.findById(truck.driverId);
        if (!driver) {
          return res.status(404).json({ message: 'Driver not found' });
        }

        res.status(200).json({
          message: 'Driver information retrieved successfully',
          driverInfo: {
            name: `${driver.firstName || ''} ${driver.lastName || ''}`.trim(),
            phoneNumber: driver.phoneNumber || '',
            address: driver.address || ''
          }
        });
      }
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve information',
        error: error.message,
      });
    }
  },


  getTasksForDriver: async (req, res) => {
    const userId = req.user._id;

    try {
      // Get user info to determine if they're a driver or helper
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { type } = userInfo;

      // Determine today's date range
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);

      // Format date in local timezone to avoid UTC conversion issues
      const year = startOfDay.getFullYear();
      const month = String(startOfDay.getMonth() + 1).padStart(2, '0');
      const day = String(startOfDay.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`; // Format: 'YYYY-MM-DD'

      // Find the truck for this user
      const truck = await getTruckForUser(userId);

      if (!truck) {
        return res
          .status(404)
          .json({ message: 'No truck found for the given user.' });
      }
      console.log("formattedDate:", formattedDate)
      // Get the task IDs for today's date from `tasksByDate`
      const taskIdsForToday = truck.tasks.get(formattedDate);

      // Fetch the tasks for the current day
      const tasks = await Task.find({
        _id: { $in: taskIdsForToday || [] }
      });

      res
        .status(200)
        .json({
          message: `Tasks for today retrieved successfully for ${type}`,
          tasks,
          userType: type
        });
    } catch (error) {
      console.error('Error retrieving tasks for user:', error);
      res.status(500).json({
        message: 'Failed to retrieve tasks',
        error: error.message || 'Unknown error occurred',
      });
    }
  },

  getTasksPerDate: async (req, res) => {
    const userId = req.user._id;
    const { date } = req.query; // Expected format: YYYY-MM-DD

    try {
      // Get user info to determine if they're a driver or helper
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { type } = userInfo;

      // Validate date parameter
      if (!date) {
        return res.status(400).json({
          message: 'Date parameter is required. Expected format: YYYY-MM-DD'
        });
      }

      // Validate date format (basic check)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        return res.status(400).json({
          message: 'Invalid date format. Expected format: YYYY-MM-DD'
        });
      }

      // Find the truck for this user
      const truck = await getTruckForUser(userId);

      if (!truck) {
        return res
          .status(404)
          .json({ message: 'No truck found for the given user.' });
      }

      console.log("Requested date:", date);

      // Get the task IDs for the specified date from `tasksByDate`
      const taskIdsForDate = truck.tasks.get(date);

      // Fetch the tasks for the specified date
      const tasks = await Task.find({
        _id: { $in: taskIdsForDate || [] }
      });

      res
        .status(200)
        .json({
          message: `Tasks for ${date} retrieved successfully for ${type}`,
          tasks,
          userType: type,
          date: date,
          taskCount: tasks.length
        });
    } catch (error) {
      console.error('Error retrieving tasks for date:', error);
      res.status(500).json({
        message: 'Failed to retrieve tasks for the specified date',
        error: error.message || 'Unknown error occurred',
      });
    }
  },


  updateTruckStart: async (req, res) => {
    const { truckId } = req.params;
    const { fuelLevel, mileageStart, conditionReport } = req.body;
    const uploads = req.files.map((file) => file.path);

    const { start, end } = getTodayDateRange();

    try {
      const statusUpdate = {
        truckId,
        pictureBefore: uploads,
        fuelLevelBefore: fuelLevel,
        mileageStart,
        conditionReport
      };

      const truckStatus = await TruckStatus.findOneAndUpdate(
        {
          truckId,
          createdAt: { $gte: start, $lte: end },
        },
        { $set: statusUpdate },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      res.status(200).json({
        message: 'Truck start status updated successfully',
        truckStatus,
      });
    } catch (error) {
      console.log("error:", error)
      res.status(500).json({
        message: 'Failed to update truck start status',
        error: error.message,
      });
    }
  },


  updateTruckEnd: async (req, res) => {
    const { truckId } = req.params;
    const { fuelLevelBefore, fuelLevelAfter, mileageEnd, conditionReport } = req.body;
    const uploads = req.files.map((file) => file.path);

    const { start, end } = getTodayDateRange();

    try {
      const statusUpdate = {
        truckId,
        pictureAfter: uploads,
        fuelLevelBefore,
        fuelLevelAfter,
        mileageEnd,
        conditionReport,
      };

      const truckStatus = await TruckStatus.findOneAndUpdate(
        {
          truckId,
          createdAt: { $gte: start, $lte: end },
        },
        { $set: statusUpdate },
        { new: true, upsert: true, setDefaultsOnInsert: true }
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

  getTruckFullStatus: async (req, res) => {
    const { truckId } = req.params;
    const { date } = req.query;

    try {
      let start, end;

      if (date) {
        // If date is provided, use that date
        const targetDate = new Date(date);
        start = new Date(targetDate);
        start.setHours(0, 0, 0, 0);
        end = new Date(targetDate);
        end.setHours(23, 59, 59, 999);
      } else {
        // Default to today
        const dateRange = getTodayDateRange();
        start = dateRange.start;
        end = dateRange.end;
      }

      const truckStatus = await TruckStatus.findOne({
        truckId,
        createdAt: { $gte: start, $lte: end },
      }).populate('truckId', 'name matricule');

      if (!truckStatus) {
        return res.status(200).json({
          message: 'No truck status found for the specified date'
        });
      }

      res.status(200).json({
        message: 'Truck full status retrieved successfully',
        truckStatus
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve truck status',
        error: error.message,
      });
    }
  },


  uploadInitialConditionPhotos: async (req, res) => {
    const { taskId } = req.params;
    const description = req.body.description;
    const uploads = req.files.map((file) => file.path);
    const userId = req.user._id;

    try {
      // Get user info
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { type } = userInfo;

      // Fetch the truck containing the task
      const truck = await getTruckForUser(userId);
      if (!truck) {
        return res.status(404).json({ message: 'No truck found for the given user.' });
      }

      // Get the current job (task)
      const currentTask = await Task.findById(taskId);
      if (!currentTask) {
        return res.status(404).json({ message: 'Current task not found.' });
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

      // Update the user's current job address based on type
      if (type === 'Driver') {
        const driverUpdate = {
          currentJobAddress: currentTask.collectionAddress ? currentTask.collectionAddress : null,
        };
        await Driver.findByIdAndUpdate(userId, driverUpdate, { new: true });
      } else if (type === 'Helper') {
        const helperUpdate = {
          currentJobAddress: currentTask.collectionAddress ? currentTask.collectionAddress : null,
        };
        await Helper.findByIdAndUpdate(userId, helperUpdate, { new: true });
      }

      // Send response
      res.status(200).json({
        message: `Initial condition photos uploaded successfully by ${type}`,
        task: updatedTask,
        userType: type
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
    const description = req.body.description;
    const uploads = req.files.map((file) => file.path);
    const userId = req.user._id;

    try {
      console.log('Processing intermediate condition photos for task:', taskId);

      // Get user info
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { type } = userInfo;

      // Fetch the truck associated with the current user
      const truck = await getTruckForUser(userId);
      if (!truck) {
        return res
          .status(404)
          .json({ message: 'No truck found for the given user.' });
      }

      console.log('Found truck:', truck._id);

      // Get the current job (task)
      const currentTask = await Task.findById(taskId);
      if (!currentTask) {
        return res.status(404).json({ message: 'Current task not found.' });
      }

      console.log('Found current task:', currentTask._id);

      // Update the task with intermediate condition photos
      const taskUpdate = {
        intermediateConditionPhotos: [
          {
            items: uploads,
            description: description,
          },
        ],
      };

      console.log('Updating task with photos:', taskUpdate);

      const task = await Task.findByIdAndUpdate(
        taskId,
        taskUpdate,
        { new: true },
      );

      console.log('Task updated successfully');

      // Update the user's current job address based on type
      if (type === 'Driver') {
        const driverUpdate = {
          currentJobAddress: currentTask.collectionAddress,
        };
        await Driver.findByIdAndUpdate(userId, driverUpdate, { new: true });
        console.log('Driver updated successfully');
      } else if (type === 'Helper') {
        const helperUpdate = {
          currentJobAddress: currentTask.collectionAddress,
        };
        await Helper.findByIdAndUpdate(userId, helperUpdate, { new: true });
        console.log('Helper updated successfully');
      }

      res.status(200).json({
        message: `Intermediate condition photos uploaded successfully by ${type}`,
        task,
        userType: type
      });
    } catch (error) {
      console.error('Error in intermediateConditionPhotos:', error);

      // Check if it's a Map error
      if (error.message && error.message.includes('Iterator value')) {
        console.error('Map error detected, attempting to clean up truck data...');

        try {
          const Truck = require('../models/Truck');
          await Truck.cleanupTasks();
          console.log('Truck tasks cleaned up successfully');

          // Retry the operation
          return res.status(500).json({
            message: 'Database cleanup required. Please try again.',
            error: 'Map data corruption detected and fixed. Please retry the operation.',
          });
        } catch (cleanupError) {
          console.error('Cleanup failed:', cleanupError);
        }
      }

      res.status(500).json({
        message: 'Failed to upload intermediate condition photos',
        error: error.message,
      });
    }
  },

  uploadFinalConditionPhotos: async (req, res) => {
    const { taskId } = req.params;
    const description = req.body.description;
    const uploads = req.files.map((file) => file.path);
    const userId = req.user._id;

    try {
      // Get user info
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { type } = userInfo;

      const taskUpdate = {
        finalConditionPhotos: [
          {
            items: uploads,
            description: description,
          },
        ],
      };

      const task = await Task.findByIdAndUpdate(taskId, taskUpdate, {
        new: true,
      });

      res.status(200).json({
        message: `Final condition photos uploaded successfully by ${type}`,
        task,
        userType: type
      });
    } catch (error) {
      console.log(error)
      res.status(500).json({
        message: 'Failed to upload final condition photos',
        error: error.message,
      });
    }
  },

  addAdditionalItems: async (req, res) => {
    const { taskId } = req.params;
    const description = req.body.description;
    const uploads = req.files.map((file) => file.path);
    const userId = req.user._id;

    try {
      // Get user info
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { type } = userInfo;

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
        { new: true },
      );

      res
        .status(200)
        .json({
          message: `Additional items added successfully by ${type}`,
          task,
          userType: type
        });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to add additional items',
        error: error.message,
      });
    }
  },

  updateJobStatus: async (req, res) => {
    const { taskId } = req.params;
    const { taskStatus } = req.body;
    const userId = req.user._id;

    try {
      // Get user info
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { type } = userInfo;

      const task = await Task.findById(taskId);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      // Update the task status
      task.taskStatus = taskStatus;
      await task.save();
      res
        .status(200)
        .json({
          message: `Task status updated successfully by ${type}`,
          task,
          userType: type
        });
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
    const { clientFeedback, clientFeedbackScale } = req.body;
    // const userId = req.user._id;

    try {
      // Get user info
      // const userInfo = await getUserModel(userId);
      // if (!userInfo) {
      //   return res.status(404).json({ message: 'User not found' });
      // }

      // const { type } = userInfo;

      const task = await Task.findById(taskId);
      if (!task) {
        console.log("task not found")
        return res.status(404).json({ message: 'Task not found' });
      }

      // Update task with the client satisfaction rating and feedback
      task.clientFeedback = clientFeedback;
      task.clientFeedbackScale = clientFeedbackScale;
      task.taskStatus = "Completed"

      // Check if this is the first task completed by this client (using email)
      const previousCompletedTasks = await Task.find({
        email: task.email,
        taskStatus: "Completed",
        _id: { $ne: task._id }
      });

      // Send review email
      await sendReviewRequestEmail({
        email: task.email,
        firstName: task.firstName,
        orderId: task._id,
      });

      await task.save();
      res.status(200).json({
        message: `Task rated successfully by `,
        task,
      });
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
      console.log("error:", error)
      console.error(error);
      return res.status(500).json({ message: 'An error occurred', error });
    }
  },

  startBreak: async (req, res) => {
    const userId = req.user._id;

    try {
      // Get user info
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { user, type } = userInfo;

      // Check if there's an active break
      const activeBreak = user.breaks.find((b) => !b.endTime);
      if (activeBreak) {
        return res
          .status(400)
          .json({ message: `${type} is already on a break` });
      }

      // Create a new break entry
      const newBreak = { startTime: new Date() };
      user.breaks.push(newBreak);
      user.onBreak = true;
      user.breakStartTime = Date.now();
      await user.save();

      emitNotificationToUser(adminId, 'Driver_Tracking', `${user.username} is taking a break`, user.username);

      return res.status(200).json({
        message: 'Break started',
        newBreak,
        userType: type
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: 'Error starting break', error });
    }
  },

  endBreak: async (req, res) => {
    const userId = req.user._id;

    try {
      // Get user info
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { user, type } = userInfo;

      if (!user.breaks || user.breaks.length === 0) {
        return res
          .status(404)
          .json({ message: `${type} not found or no active breaks` });
      }

      // Get the last break and update it
      const lastBreak = user.breaks[user.breaks.length - 1];
      if (lastBreak.endTime) {
        return res.status(400).json({ message: 'Break already ended' });
      }

      lastBreak.endTime = new Date();
      // Calculate duration in minutes
      lastBreak.duration = Math.round(
        (lastBreak.endTime - lastBreak.startTime) / (1000 * 60),
      );
      user.onBreak = false;
      await user.save();

      return res.status(200).json({
        message: 'Break ended',
        lastBreak,
        userType: type
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: 'Error ending break', error });
    }
  },

  getBreakTimer: async (req, res) => {
    const userId = req.user._id;

    try {
      // Get user info
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { user, type } = userInfo;

      // Check if user.breaks exists and is not empty
      if (!user.breaks || user.breaks.length === 0) {
        return res
          .status(200)
          .json({ message: 'No breaks found', isActive: false, elapsed: 0, userType: type });
      }

      // Get the last break and calculate the elapsed time
      const lastBreak = user.breaks[user.breaks.length - 1];

      // If lastBreak is active (no endTime)
      if (!lastBreak.endTime) {
        const now = new Date();
        const elapsedMilliseconds = now - lastBreak.startTime;
        const elapsedSeconds = Math.floor(elapsedMilliseconds / 1000);
        return res.status(200).json({
          message: 'Break timer',
          isActive: true,
          elapsed: elapsedSeconds,
          userType: type
        });
      }

      return res
        .status(200)
        .json({ message: 'No active break', isActive: false, elapsed: 0, userType: type });
    } catch (error) {
      console.error(error);
      return res
        .status(500)
        .json({ message: 'Error getting break timer', error });
    }
  },
};

module.exports = driverManagement;
