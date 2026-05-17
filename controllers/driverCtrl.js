const { User } = require('../models/User');
const Helper = require('../models/Helper');
const Task = require('../models/Task');
const Truck = require('../models/Truck');
const TruckStatus = require('../models/TruckStatus');
const TippingRequest = require('../models/TippingRequest');
const Payroll = require('../models/Payroll');
const DriverHelperProximityState = require('../models/DriverHelperProximityState');
const bcrypt = require('bcrypt');
const Driver = require('../models/Driver');
const AdditionalItemRequest = require('../models/AdditionalItemRequest');
const { emitNotificationToUser, emitEvent } = require('../socket');
const { sendWasteTransferNoteEmail } = require('../services/emailsService');
const { getAssignedForDayFromRanges } = require('../services/unitAssignmentLogService');
const dailySheetController = require('./dailySheetController');
const payrollCtrl = require('./payrollCtrl');
const adminId = "67cb6810c9e768ec25d39523"

function getTodayDateRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function getTodayDateKeyLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const END_LOCATION_ARRIVAL_METERS = Number(
  process.env.DRIVER_HELPER_END_ARRIVAL_METERS ||
    process.env.DRIVER_HELPER_ARRIVAL_METERS ||
    80
);

// Helper function to get user model based on role
async function getUserModel(userId) {
  // Try to find user in User model first
  let user = await User.findById(userId);
  if (user) {
    if (user.role.includes('Driver')) {
      return { user, model: 'User', type: 'Driver' };
    } else if (user.role.includes('Helper')) {
      return { user, model: 'User', type: 'Helper' };
    } else if (user.role.includes('Admin')) {
      return { user, model: 'User', type: 'Admin' };
    }
  }



  return null;
}

// Helper function to get truck for user (driver or helper)
async function getTruckForUser(userId) {
  // First try to find truck by primary driverId
  let truck = await Truck.findOne({ driverId: userId });
  if (truck) {
    return truck;
  }

  // Try to find truck by primary helperId
  truck = await Truck.findOne({ helperId: userId });
  if (truck) {
    return truck;
  }

  // Try to find truck where user is an extra driver
  truck = await Truck.findOne({ 'extraDrivers.driverId': userId });
  if (truck) {
    return truck;
  }

  // Try to find truck where user is an extra helper
  truck = await Truck.findOne({ 'extraHelpers.helperId': userId });
  if (truck) {
    return truck;
  }

  return null;
}

// Helper function to format tipping request as task
function formatTippingRequestAsTask(tippingRequest) {
  return {
    _id: `tipping_${tippingRequest._id}`,
    type: 'tipping_request',
    orderNumber: `TIP-${tippingRequest._id.toString().slice(-6)}`,
    firstName: 'Tipping Request',
    lastName: '',
    phoneNumber: '',
    email: '',
    totalPrice: tippingRequest.price || 0,
    taskStatus: tippingRequest.status === 'Accepted' ? 'Completed' :
      tippingRequest.status === 'Denied' ? 'Declined' : 'Processing',
    paymentStatus: tippingRequest.status === 'Accepted' ? 'Paid' : 'Not_Paid',
    paymentMethod: 'cash',
    date: new Date(tippingRequest.createdAt).toISOString().split('T')[0],
    available: 'AnyTime',
    location: {
      type: 'Point',
      coordinates: [0, 0],
      address: 'Tipping Request'
    },
    items: [{
      object: 'Tipping Request',
      Objectsposition: 'Outside',
      quantity: 1,
      price: tippingRequest.price || 0
    }],
    clientObjectPhotos: tippingRequest.tippingProof || [],
    initialConditionPhotos: [],
    intermediateConditionPhotos: [],
    finalConditionPhotos: [],
    additionalItems: [],
    additionalNotes: tippingRequest.notes || '',
    privateNotes: '',
    createdAt: tippingRequest.createdAt,
    updatedAt: tippingRequest.updatedAt,
    // Tipping request specific fields
    tippingRequestId: tippingRequest._id,
    tippingPlace: tippingRequest.tippingPlace,
    storagePlace: tippingRequest.storagePlace,
    isShipped: tippingRequest.isShipped,
    createdByType: 'driver'
  };
}

// Helper function to get unified tasks and tipping requests
async function getUnifiedTasksForDate(truck, date) {
  const tasksForDate = truck.getTasksForDate(date);
  const unifiedTasks = [];

  for (const taskRef of tasksForDate) {
    if (taskRef.type === 'Task' || taskRef.type === 'task') {
      const task = await Task.findById(taskRef.taskId).populate('items.standardItemId');
      if (task) {
        const taskObj = task.toObject ? task.toObject() : task;
        taskObj.type = 'regular_task';
        taskObj.customOrder = taskRef.order;
        unifiedTasks.push(taskObj);
      }
    } else if (taskRef.type === 'TippingRequest') {
      const tippingRequest = await TippingRequest.findById(taskRef.taskId)
        .populate('tippingPlace', 'name address')
        .populate('storagePlace', 'name address');
      if (tippingRequest) {
        const tippingObj = formatTippingRequestAsTask(tippingRequest);
        tippingObj.customOrder = taskRef.order;
        unifiedTasks.push(tippingObj);
      }
    }
  }

  // Sort by custom order to maintain the sequence
  unifiedTasks.sort((a, b) => a.customOrder - b.customOrder);
  return unifiedTasks;
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
      drivingLicenseFront,
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
      if (drivingLicenseFront) user.drivingLicenseFront = drivingLicenseFront;

      // Update files if new files are uploaded
      if (req.files) {
        if (req.files.picture) user.picture = req.files.picture[0].path;
        if (req.files.drivingLicenseFront) user.drivingLicenseFront = req.files.drivingLicenseFront[0].path;
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
      const drivingLicenseFrontValue = user.drivingLicenseFront || user.DriverLicense;
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
          drivingLicenseFront: drivingLicenseFrontValue,
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

  getDriverDistanceToHelper: async (req, res) => {
    const userId = req.user._id;
    const arrivalThresholdMeters = Number(process.env.DRIVER_HELPER_ARRIVAL_METERS || 80);

    try {
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { type } = userInfo;
      if (type !== 'Driver') {
        return res.status(403).json({ message: 'Only drivers can access this endpoint' });
      }

      const truck = await getTruckForUser(userId);
      if (!truck) {
        return res.status(404).json({ message: 'No truck found for the given user.' });
      }

      if (!truck.helperId) {
        return res.status(404).json({ message: 'No helper assigned to this truck' });
      }

      const driver = await Driver.findById(userId).select('location');
      const helper = await Helper.findById(truck.helperId).select('location username');

      const driverCoords = driver?.location?.coordinates;
      const helperCoords = helper?.start_location?.coordinates;

      if (!Array.isArray(driverCoords) || driverCoords.length < 2) {
        return res.status(404).json({ message: 'Driver location is not set' });
      }
      if (!Array.isArray(helperCoords) || helperCoords.length < 2) {
        return res.status(404).json({ message: 'Helper location is not set' });
      }

      const driverLng = Number(driverCoords[0]);
      const driverLat = Number(driverCoords[1]);
      const helperLng = Number(helperCoords[0]);
      const helperLat = Number(helperCoords[1]);

      if (
        !Number.isFinite(driverLat) ||
        !Number.isFinite(driverLng) ||
        !Number.isFinite(helperLat) ||
        !Number.isFinite(helperLng)
      ) {
        return res.status(400).json({ message: 'Invalid driver/helper coordinates' });
      }

      const distanceMeters = Math.round(
        haversineMeters(driverLat, driverLng, helperLat, helperLng)
      );
      const remainingMeters = Math.max(distanceMeters - arrivalThresholdMeters, 0);

      return res.status(200).json({
        message: 'Distance to helper retrieved successfully',
        distanceMeters,
        remainingMeters,
        arrivalThresholdMeters,
        hasArrivedToHelper: distanceMeters <= arrivalThresholdMeters,
        helperId: truck.helperId,
        helperName: helper?.username || null,
      });
    } catch (error) {
      console.error('Error getting distance to helper:', error);
      return res.status(500).json({
        message: 'Failed to get distance to helper',
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

      // Get unified tasks and tipping requests for today
      const allTasks = await getUnifiedTasksForDate(truck, formattedDate);

      res
        .status(200)
        .json({
          message: `Tasks for today retrieved successfully for ${type}`,
          tasks: allTasks,
          userType: type,
          totalTasksCount: allTasks.length
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

      // Get unified tasks and tipping requests for the specified date
      const allTasks = await getUnifiedTasksForDate(truck, date);

      res
        .status(200)
        .json({
          message: `Tasks for ${date} retrieved successfully for ${type}`,
          tasks: allTasks,
          userType: type,
          date: date,
          totalTasksCount: allTasks.length
        });
    } catch (error) {
      console.error('Error retrieving tasks for date:', error);
      res.status(500).json({
        message: 'Failed to retrieve tasks for the specified date',
        error: error.message || 'Unknown error occurred',
      });
    }
  },

  addTippingRequestToTruck: async (req, res) => {
    const userId = req.user._id;
    const { tippingRequestId, date, order, truckId } = req.body;
    console.log("tippingRequestId:", tippingRequestId)
    console.log("date:", date)
    console.log("order:", order)
    console.log("userId:", userId)
    console.log("truckId:", truckId)
    try {
      // Get user info
      const userInfo = await getUserModel(userId);
      console.log("userInfo:", userInfo)
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Find the truck - either by truckId (for admin) or by user assignment (for drivers)
      let truck;
      if (truckId) {
        // Admin specifying which truck to use
        truck = await Truck.findById(truckId);
        if (!truck) {
          return res.status(404).json({ message: 'Truck not found.' });
        }
      } else {
        // Driver using their assigned truck
        truck = await getTruckForUser(userId);
        if (!truck) {
          return res.status(404).json({ message: 'No truck found for the given user.' });
        }
      }

      // Verify tipping request exists
      const tippingRequest = await TippingRequest.findById(tippingRequestId);
      if (!tippingRequest) {
        return res.status(404).json({ message: 'Tipping request not found' });
      }



      // Add tipping request to truck's task list
      truck.addTippingRequest(date, tippingRequestId, order || 0);
      await truck.save();

      // Update truckId on tipping request if not set
      if (!tippingRequest.truckId) {
        tippingRequest.truckId = truck._id;
        await tippingRequest.save();
      }

      // Update daily sheets for the driver
      try {
        if (truck.driverId) {
          console.log('Updating daily sheets after adding tipping request to truck');
          
          const mockReq = {
            body: { date: date }
          };
          const mockRes = {
            status: () => ({ json: () => { } }),
            json: () => { }
          };
          
          await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
          console.log('Daily sheets updated after adding tipping request for date:', date);
        }
      } catch (dailySheetError) {
        console.error('Error updating daily sheets after adding tipping request:', dailySheetError);
        // Don't fail the main operation if daily sheet update fails
      }

      res.status(200).json({
        message: 'Tipping request added to truck tasks successfully',
        truckId: truck._id,
        truckName: truck.name || (truck.vanId ? (truck.vanId.name || truck.vanId.matricule) : truck._id),
        date: date,
        order: order || 0
      });

    } catch (error) {
      console.error('Error adding tipping request to truck:', error);
      res.status(500).json({
        message: 'Failed to add tipping request to truck',
        error: error.message
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
      ).populate({ path: 'truckId', select: 'vanId driverId helperId', populate: { path: 'vanId', select: 'name matricule' } });

      // Send notification to all admins
      try {
        const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
        const truck = truckStatus?.truckId;
        const truckName = truck && truck.vanId ? (truck.vanId.name || truck.vanId.matricule) : (truck ? truck._id.toString() : 'Truck');

        // Get driver name if available
        let driverName = '';
        if (truck?.driverId) {
          const driver = await Driver.findById(truck.driverId).select('username firstName lastName');
          if (driver) {
            driverName = driver.username || `${driver.firstName || ''} ${driver.lastName || ''}`.trim() || 'Driver';
          }
        }

        const notificationMessage = driverName
          ? `${driverName} has ended the day for ${truckName}`
          : `Truck end status updated for ${truckName}`;

        // Send notification to all admins
        for (const admin of adminUsers) {
          if (admin._id) {
            await emitNotificationToUser(
              admin._id.toString(),
              'Driver_Tracking',
              notificationMessage,
              driverName || truckName
            );
          }
        }

        // Also send to the hardcoded adminId as a fallback
        if (adminId) {
          await emitNotificationToUser(
            adminId,
            'Driver_Tracking',
            notificationMessage,
            driverName || truckName
          );
        }
      } catch (notificationError) {
        console.error('Error sending notification to admin:', notificationError);
        // Don't fail the request if notification fails
      }

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
    const uploads = Array.isArray(req.files) ? req.files.map((file) => file.path) : [];
    const userId = req.user._id;

    try {
      // Get user info
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { type } = userInfo;
      const itemName = String(description || '').trim();
      if (!itemName) {
        return res.status(400).json({ message: 'description is required' });
      }

      const quantity = Number(req.body.quantity);
      const normalizedQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;

      const task = await Task.findById(taskId);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      const requestPayload = {
        parentTaskId: task._id,
        itemName,
        quantity: normalizedQuantity,
        Objectsposition: 'Outside',
        quotedPrice: null,
        media: uploads,
        status: 'pending_admin_quote',
        requestedBy: userId,
        requestedByType: type,
      };

      const createdRequest = await AdditionalItemRequest.create(requestPayload);
      const actorName = userInfo?.user?.username || `${task.firstName || ''} ${task.lastName || ''}`.trim() || type;
      const adminUsers = await User.find({
        $or: [{ roleType: 'Admin' }, { role: 'Admin' }],
      }).select('_id');
      const notificationMessage = `${actorName} submitted an additional item request for order ${task.orderNumber}: "${itemName}"`;
      await Promise.all(
        adminUsers.map((adminUser) =>
          emitNotificationToUser(adminUser._id.toString(), 'Orders', notificationMessage),
        ),
      );

      res
        .status(200)
        .json({
          message: `Additional item request submitted successfully by ${type}`,
          request: createdRequest,
          taskId: task._id,
          userType: type
        });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to submit additional item request',
        error: error.message,
      });
    }
  },
  // this api is not used in the project
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

      // Send Waste Transfer Note only when completed and already paid.
      // Otherwise, noon cron will send it once payment becomes Paid.
      if (task.taskStatus === 'Completed' && task.paymentStatus === 'Paid') {
        await sendWasteTransferNoteEmail(task._id);
      }

      // Update Google Calendar event if it exists
      if (task.googleCalendarEventId) {
        try {
          const { updateCalendarEvent } = require('../services/calendarService');
          const { User } = require('../models/User');
          const admin = await User.findOne({
            role: 'Admin',
            gmailTokens: { $exists: true, $ne: null }
          });

          if (admin) {
            await updateCalendarEvent(admin._id.toString(), task, task.googleCalendarEventId);
            console.log('✅ Calendar event updated for order:', task.orderNumber);
          }
        } catch (calendarError) {
          if (calendarError.message?.includes('CALENDAR_SCOPE_MISSING') ||
            calendarError.message?.includes('INVALID_GRANT')) {
            console.error('⚠️ Calendar integration requires re-authentication.');
            console.error('💡 Admin should visit: /api/gmail/auth/google?adminId=' + admin?._id);
          } else {
            console.error('❌ Error updating calendar event:', calendarError.message);
          }
        }
      }

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

  updateTaskRedflag: async (req, res) => {
    const { taskId } = req.params;
    const { redflag } = req.body;
    const userId = req.user._id;

    try {
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      if (redflag === undefined) {
        return res.status(400).json({
          message: 'redflag is required (send true or false)',
          error: 'REDFLAG_REQUIRED',
        });
      }

      const task = await Task.findById(taskId);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      const value = redflag === true || redflag === 'true';
      task.redflag = value;
      await task.save();

      res.status(200).json({
        message: 'Task red flag updated successfully',
        task,
        userType: userInfo.type,
      });
    } catch (error) {
      console.error('Error updating task redflag:', error);
      res.status(500).json({
        message: 'Failed to update task red flag',
        error: error.message,
      });
    }
  },

  rateTask: async (req, res) => {
    const { taskId } = req.params;
    const {
      clientFeedback,
      clientFeedbackScale,
      cashAmount,
      cashReceived,
      cashRecived,
      customerNotPresent
    } = req.body;
    const userId = req.user._id;

    try {
      // Get user info
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const normalizedCashReceived = Number(
        cashAmount ?? cashReceived ?? cashRecived ?? 0
      );
      const normalizedFeedbackScale = Number(clientFeedbackScale);
      const isCustomerNotPresent = customerNotPresent === 'true' || customerNotPresent === true;

      console.log("username", userInfo.user.username, "cashAmount", normalizedCashReceived);
      const task = await Task.findById(taskId);
      if (!task) {
        console.log("task not found");
        return res.status(404).json({ message: 'Task not found' });
      }

      // Handle signature upload if provided
      let signaturePath = null;
      if (req.file) {
        signaturePath = req.file.path;
      }

      // Validate: if customer is not present, signature should not be provided
      if (isCustomerNotPresent && signaturePath) {
        return res.status(400).json({
          message: 'Cannot have signature when customer is not present'
        });
      }

      // Update task with the client satisfaction rating and feedback
      task.clientFeedback = clientFeedback;
      task.clientFeedbackScale = Number.isFinite(normalizedFeedbackScale) ? normalizedFeedbackScale : undefined;
      task.taskStatus = "Completed";
      task.cashReceived = Number.isFinite(normalizedCashReceived) ? normalizedCashReceived : 0;
      // Store the user id who took the cash (for payroll and daily-sheet cash totals)
      task.cashReceivedBy = userInfo.user._id || req.user._id;

      // Save signature and customer presence status (same as other feedback fields)
      task.customerSignature = signaturePath || null;
      task.customerNotPresent = isCustomerNotPresent;

      // Check if this is the first task completed by this client (using email)
      const previousCompletedTasks = await Task.find({
        email: task.email,
        taskStatus: "Completed",
        _id: { $ne: task._id }
      });

      // Review email will be sent automatically the next day at 12pm via cron job
      // See: cron/sendReviewEmails.js

      await task.save();

      // Recalculate payroll totalCash and DailySheet totalCash after setting cash on task
      try {
        if (task.cashReceivedBy) {
          await payrollCtrl.recalculatePayrollTotalCash(task.date, task.cashReceivedBy);
        }
        await dailySheetController.recalculateDailySheetTotalCashForTask(task._id);
      } catch (err) {
        console.error('Error recalculating payroll/DailySheet totalCash after rateTask:', err);
      }

      // Send Waste Transfer Note only when completed and already paid.
      // Otherwise, noon cron will send it once payment becomes Paid.
      if (task.paymentStatus === 'Paid') {
        await sendWasteTransferNoteEmail(task._id);
      }
      res.status(200).json({
        message: `Task rated successfully`,
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

      // Send notification to all admins
      try {
        const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
        const userName = user.username || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Driver/Helper';
        const notificationMessage = `${userName} has started their day`;

        // Send notification to all admins
        for (const admin of adminUsers) {
          if (admin._id) {
            await emitNotificationToUser(
              admin._id.toString(),
              'Driver_Tracking',
              notificationMessage,
              userName
            );
          }
        }

        // Also send to the hardcoded adminId as a fallback
        if (adminId) {
          await emitNotificationToUser(
            adminId,
            'Driver_Tracking',
            notificationMessage,
            userName
          );
        }
      } catch (notificationError) {
        console.error('Error sending notification to admin:', notificationError);
        // Don't fail the request if notification fails
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

      // Send notification to all admins
      try {
        const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
        const userName = user.username || `${user.firstName || ''} ${user.lastName || ''}`.trim() || type;
        const notificationMessage = `${userName} is taking a break`;

        // Send notification to all admins
        for (const admin of adminUsers) {
          if (admin._id) {
            await emitNotificationToUser(
              admin._id.toString(),
              'Driver_Tracking',
              notificationMessage,
              userName
            );
          }
        }

        // Also send to the hardcoded adminId as a fallback
        if (adminId) {
          await emitNotificationToUser(
            adminId,
            'Driver_Tracking',
            notificationMessage,
            userName
          );
        }
      } catch (notificationError) {
        console.error('Error sending notification to admin:', notificationError);
        // Don't fail the request if notification fails
      }

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

      // Send notification to all admins
      try {
        const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
        const userName = user.username || `${user.firstName || ''} ${user.lastName || ''}`.trim() || type;
        const notificationMessage = `${userName} has ended their break (${lastBreak.duration} minutes)`;

        // Send notification to all admins
        for (const admin of adminUsers) {
          if (admin._id) {
            await emitNotificationToUser(
              admin._id.toString(),
              'Driver_Tracking',
              notificationMessage,
              userName
            );
          }
        }

        // Also send to the hardcoded adminId as a fallback
        if (adminId) {
          await emitNotificationToUser(
            adminId,
            'Driver_Tracking',
            notificationMessage,
            userName
          );
        }
      } catch (notificationError) {
        console.error('Error sending notification to admin:', notificationError);
        // Don't fail the request if notification fails
      }

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

  updateMyLocation: async (req, res) => {
    const userId = req.user._id;
    const { latitude, longitude } = req.body;
    console.log('Updating location for user:', userId);
    try {
      // Validate input
      if (!latitude || !longitude) {
        return res.status(400).json({
          message: 'Latitude and longitude are required'
        });
      }

      // Get user info to determine if they're a driver or helper
      const userInfo = await getUserModel(userId);
      if (!userInfo) {
        return res.status(404).json({ message: 'User not found' });
      }

      const { type } = userInfo;

      // Get the actual Driver or Helper model to update location
      let user;
      if (type === 'Driver') {
        user = await Driver.findById(userId);
      } else if (type === 'Helper') {
        user = await Helper.findById(userId);
      } else {
        return res.status(403).json({
          message: 'Only drivers and helpers can update location'
        });
      }

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Update location directly on the document
      const coordinatesArray = [longitude, latitude];
      user.location = { type: 'Point', coordinates: coordinatesArray };

      // Save the document
      await user.save();

      // Emit the location update to all connected clients (same as socket handler)
      emitEvent('driverLocationUpdate', {
        driverId: userId,
        driverName: user.username,
        coordinates: { latitude, longitude },
        picture: user.picture,
        currentJobAddress: user.currentJobAddress,
        nextJobAddress: user.nextJobAddress,
        onBreak: user.onBreak,
        startTime: user.breakStartTime,
      });

      res.status(200).json({
        message: 'Location updated successfully',
        location: user.location
      });
    } catch (error) {
      console.error(`Error updating location for user ${userId}:`, error);
      res.status(500).json({
        message: 'Failed to update location',
        error: error.message
      });
    }
  },

  /**
   * Check if a driver/helper's shift has started for a given day
   * GET /api/driver/day-start-status
   * Query params: userId (optional, uses auth user if not provided), date (YYYY-MM-DD format, defaults to today)
   * Returns: { hasStarted: boolean, dayStarted: boolean, payrollId: string|null, startTime: Date|null }
   */
  getDayStartStatus: async (req, res) => {
    try {
      // Get userId from query params or from authenticated user
      const userId = req.query.userId || req.user._id;

      // Get date from query params or default to today
      let targetDate;
      if (req.query.date) {
        // Parse the date string (expected format: YYYY-MM-DD)
        targetDate = new Date(req.query.date);
        if (isNaN(targetDate.getTime())) {
          return res.status(400).json({
            message: 'Invalid date format. Expected YYYY-MM-DD',
            hasStarted: false,
            dayStarted: false
          });
        }
      } else {
        targetDate = new Date();
      }

      // Set date range for the target day (start of day to end of day)
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Check for an active payroll record (shift started today with no end time)
      const activePayroll = await Payroll.findOne({
        userId: userId,
        startTime: { $gte: startOfDay, $lte: endOfDay },
        endTime: null
      });

      if (activePayroll) {
        return res.status(200).json({
          hasStarted: true,
          dayStarted: true,
          isShiftActive: true,
          payrollId: activePayroll._id,
          startTime: activePayroll.startTime,
          message: 'Shift is currently active'
        });
      }

      // Check if there was a completed shift today (has both start and end time)
      const completedPayroll = await Payroll.findOne({
        userId: userId,
        startTime: { $gte: startOfDay, $lte: endOfDay },
        endTime: { $ne: null }
      });

      if (completedPayroll) {
        return res.status(200).json({
          hasStarted: true,
          dayStarted: true,
          isShiftActive: false,
          payrollId: completedPayroll._id,
          startTime: completedPayroll.startTime,
          endTime: completedPayroll.endTime,
          message: 'Shift was completed for this day'
        });
      }

      // No payroll record found for this day
      return res.status(200).json({
        hasStarted: false,
        dayStarted: false,
        isShiftActive: false,
        payrollId: null,
        startTime: null,
        message: 'No shift started for this day'
      });

    } catch (error) {
      console.error('Error checking day start status:', error);
      return res.status(500).json({
        message: 'Failed to check day start status',
        error: error.message,
        hasStarted: false,
        dayStarted: false
      });
    }
  },

  /**
   * Get start button eligibility based on driver-helper proximity state.
   * GET /api/driver/start-button-status
   */
  getStartButtonStatus: async (req, res) => {
    try {
      const userId = req.user._id;
      const dateKey = req.query.dateKey || getTodayDateKeyLocal();

      const truck = await getTruckForUser(userId);
      if (!truck) {
        return res.status(200).json({
          message: 'No truck found for the given user.',
          enabled: false,
          dateKey,
          truckId: null,
          distanceMeters: null,
          arrivalTriggeredAt: null,
        });
      }

      const state = await DriverHelperProximityState.findOne({
        truckId: truck._id,
        dateKey,
      });

      return res.status(200).json({
        message: 'Start button status retrieved successfully',
        enabled: state?.autoStartTriggered === true,
        dateKey,
        truckId: truck._id,
        distanceMeters: Number.isFinite(Number(state?.lastDistanceMeters))
          ? Number(state.lastDistanceMeters)
          : null,
        arrivalTriggeredAt: state?.arrivalTriggeredAt || null,
      });
    } catch (error) {
      console.error('Error getting start button status:', error);
      return res.status(500).json({
        message: 'Failed to get start button status',
        error: error.message,
      });
    }
  },

  /**
   * Get end button eligibility based on driver distance to helper end_location.
   * GET /api/driver/end-button-status
   */
  getEndButtonStatus: async (req, res) => {
    try {
      const userId = req.user._id;
      const dateKey = req.query.dateKey || getTodayDateKeyLocal();

      const truck = await getTruckForUser(userId);
      if (!truck) {
        return res.status(200).json({
          message: 'No truck found for the given user.',
          enabled: false,
          dateKey,
          truckId: null,
          distanceMeters: null,
          arrivalThresholdMeters: END_LOCATION_ARRIVAL_METERS,
          helperEndLocationSet: false,
        });
      }

      const assigned = await getAssignedForDayFromRanges(truck._id, dateKey);
      const effectiveHelperId = assigned?.helperId || truck.helperId || null;
      const [driverUser, helper] = await Promise.all([
        Driver.findById(userId).select('location end_location'),
        effectiveHelperId ? Helper.findById(effectiveHelperId).select('end_location') : null,
      ]);

      const driverCoords = driverUser?.location?.coordinates;
      const targetEndCoords = effectiveHelperId
        ? helper?.end_location?.coordinates
        : driverUser?.end_location?.coordinates;
      const hasValidDriverLocation =
        Array.isArray(driverCoords) && driverCoords.length >= 2;
      const hasValidTargetEndLocation =
        Array.isArray(targetEndCoords) && targetEndCoords.length >= 2;

      if (!hasValidDriverLocation || !hasValidTargetEndLocation) {
        return res.status(200).json({
          message: 'End button status retrieved successfully',
          enabled: false,
          dateKey,
          truckId: truck._id,
          distanceMeters: null,
          arrivalThresholdMeters: END_LOCATION_ARRIVAL_METERS,
          helperEndLocationSet: hasValidTargetEndLocation,
        });
      }

      const driverLng = Number(driverCoords[0]);
      const driverLat = Number(driverCoords[1]);
      const targetEndLng = Number(targetEndCoords[0]);
      const targetEndLat = Number(targetEndCoords[1]);

      if (
        !Number.isFinite(driverLat) ||
        !Number.isFinite(driverLng) ||
        !Number.isFinite(targetEndLat) ||
        !Number.isFinite(targetEndLng)
      ) {
        return res.status(200).json({
          message: 'End button status retrieved successfully',
          enabled: false,
          dateKey,
          truckId: truck._id,
          distanceMeters: null,
          arrivalThresholdMeters: END_LOCATION_ARRIVAL_METERS,
          helperEndLocationSet: hasValidTargetEndLocation,
        });
      }

      const distanceMeters = Math.round(
        haversineMeters(driverLat, driverLng, targetEndLat, targetEndLng)
      );

      return res.status(200).json({
        message: 'End button status retrieved successfully',
        enabled: distanceMeters <= END_LOCATION_ARRIVAL_METERS,
        dateKey,
        truckId: truck._id,
        distanceMeters,
        arrivalThresholdMeters: END_LOCATION_ARRIVAL_METERS,
        helperEndLocationSet: true,
      });
    } catch (error) {
      console.error('Error getting end button status:', error);
      return res.status(500).json({
        message: 'Failed to get end button status',
        error: error.message,
      });
    }
  },

  /**
   * Get all drivers and helpers who are currently on work (active shift)
   * together with their last known location and basic info.
   *
   * GET /api/driver/on-work-locations
   * Returns all staff with active shifts (endTime: null), regardless of date
   */
  getOnWorkStaffLocations: async (req, res) => {
    try {
      // Find all active payrolls (shift not yet ended, any start date)
      const activePayrolls = await Payroll.find({
        endTime: null,
      })
        .populate({
          path: 'userId',
          select:
            'username firstName lastName role roleType location picture currentJobAddress nextJobAddress onBreak truckId',
        })
        .populate({
          path: 'truckId',
          select: 'vanId driverId helperId',
          populate: { path: 'vanId', select: 'name matricule' },
        });

      const staff = activePayrolls
        .map((payroll) => {
          const user = payroll.userId;
          if (!user) return null;

          const roles = Array.isArray(user.role) ? user.role : [];
          const isDriver =
            roles.includes('Driver') || user.roleType === 'Driver';
          const isHelper =
            roles.includes('Helper') || user.roleType === 'Helper';

          // Only include drivers and helpers
          if (!isDriver && !isHelper) return null;

          const truck = payroll.truckId;

          return {
            userId: user._id,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            role: isDriver ? 'Driver' : 'Helper',
            roleType: user.roleType,
            location: user.location || null,
            picture: user.picture || null,
            currentJobAddress: user.currentJobAddress || null,
            nextJobAddress: user.nextJobAddress || null,
            onBreak: !!user.onBreak,
            shiftStartTime: payroll.startTime,
            truck: truck
              ? {
                id: truck._id,
                name: truck.name || (truck.vanId ? (truck.vanId.name || truck.vanId.matricule) : null),
                matricule: truck.vanId ? truck.vanId.matricule : null,
                driverId: truck.driverId,
                helperId: truck.helperId,
              }
              : null,
          };
        })
        .filter(Boolean);

      return res.status(200).json({
        message:
          'On-work drivers and helpers with last location retrieved successfully',
        count: staff.length,
        staff,
      });
    } catch (error) {
      console.error('Error getting on-work staff locations:', error);
      return res.status(500).json({
        message: 'Failed to get on-work staff locations',
        error: error.message,
      });
    }
  },

  /**
   * Get current and next job addresses for a truck
   * GET /api/driver/truck/:truckId/job-addresses
   * Returns the address of the current job and the next one
   */
  getCurrentAndNextJobAddress: async (req, res) => {
    const { truckId } = req.params;

    try {
      // Find the truck by ID
      const truck = await Truck.findById(truckId);
      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      // Get today's date in YYYY-MM-DD format
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;

      // Get tasks for today using the truck's method
      const tasksForDate = truck.getTasksForDate(formattedDate);

      if (!tasksForDate || tasksForDate.length === 0) {
        return res.status(200).json({
          message: 'No jobs found for today',
          currentJob: null,
          nextJob: null
        });
      }

      // Fetch all tasks and tipping requests with their details
      const jobsWithDetails = [];

      for (const taskRef of tasksForDate) {
        if (taskRef.type === 'Task' || taskRef.type === 'task') {
          const task = await Task.findById(taskRef.taskId);
          if (task) {
            jobsWithDetails.push({
              id: task._id,
              type: 'task',
              address: task.collectionAddress,
              status: task.taskStatus,
              isCompleted: task.taskStatus === 'Completed',
              order: taskRef.order
            });
          }
        } else if (taskRef.type === 'TippingRequest') {
          const tippingRequest = await TippingRequest.findById(taskRef.taskId)
            .populate('tippingPlace', 'name address')
            .populate('storagePlace', 'name address');

          if (tippingRequest) {
            // Prefer tippingPlace address, fallback to storagePlace
            const address = tippingRequest.tippingPlace?.address ||
              tippingRequest.storagePlace?.address ||
              'Address not available';

            jobsWithDetails.push({
              id: tippingRequest._id,
              type: 'tipping',
              address: address,
              status: tippingRequest.status,
              isShipped: tippingRequest.isShipped,
              isCompleted: tippingRequest.isShipped === true,
              order: taskRef.order
            });
          }
        }
      }

      // Sort by order
      jobsWithDetails.sort((a, b) => a.order - b.order);

      // Find current job and next job
      let currentJob = null;
      let nextJob = null;

      // Filter out completed/declined jobs to find incomplete jobs
      // For tasks: not Completed or Declined
      // For tipping requests: isShipped is false
      const incompleteJobs = jobsWithDetails.filter(job => {
        if (job.type === 'task') {
          return job.status !== 'Completed' && job.status !== 'Declined';
        } else if (job.type === 'tipping') {
          return job.isShipped !== true;
        }
        return true;
      });

      if (incompleteJobs.length > 0) {
        // If there are incomplete jobs, first incomplete is current
        currentJob = incompleteJobs[0];

        // For next job, find the next job in the original list (can be completed or incomplete)
        const currentJobIndex = jobsWithDetails.findIndex(job => job.id.toString() === currentJob.id.toString());
        if (currentJobIndex !== -1 && currentJobIndex + 1 < jobsWithDetails.length) {
          nextJob = jobsWithDetails[currentJobIndex + 1];
        }
      } else {
        // All jobs are completed - show last completed as current
        const completedJobs = jobsWithDetails.filter(job => job.isCompleted === true);
        if (completedJobs.length > 0) {
          currentJob = completedJobs[completedJobs.length - 1];
        }
      }

      const response = {
        message: 'Job addresses retrieved successfully',
        currentJob: currentJob ? {
          id: currentJob.id,
          type: currentJob.type,
          address: currentJob.address,
          status: currentJob.status,
          isShipped: currentJob.isShipped
        } : null,
        nextJob: nextJob ? {
          id: nextJob.id,
          type: nextJob.type,
          address: nextJob.address,
          status: nextJob.status,
          isShipped: nextJob.isShipped
        } : null,
        totalJobsToday: jobsWithDetails.length,
        completedJobsCount: jobsWithDetails.filter(j => j.isCompleted === true).length
      };

      console.log('=== Job Addresses Response ===');
      console.log('Truck ID:', truckId);
      console.log('Date:', formattedDate);
      console.log('Current Job:', JSON.stringify(response.currentJob, null, 2));
      console.log('Next Job:', JSON.stringify(response.nextJob, null, 2));
      console.log('Total Jobs Today:', response.totalJobsToday);
      console.log('Completed Jobs (Tasks Completed + Tips Shipped):', response.completedJobsCount);
      console.log('==============================');

      res.status(200).json(response);

    } catch (error) {
      console.error('Error retrieving job addresses:', error);
      res.status(500).json({
        message: 'Failed to retrieve job addresses',
        error: error.message
      });
    }
  },
};

module.exports = driverManagement;
