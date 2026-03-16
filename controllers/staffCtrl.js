const { User } = require('../models/User');
const Driver = require('../models/Driver');
const Helper = require('../models/Helper');
const Admin = require('../models/Admin');
const Truck = require('../models/Truck');
const { findTruckByTruckName } = require('../utils/truckHelpers');
const bcrypt = require('bcrypt');
const socket = require('../socket'); // Ensure you have the correct path to your socket module
const APIfeatures = require('../utils/APIFeatures');
const { optimizeRoute } = require('../helper/OpitomRoute');
const loggingService = require('../services/loggingService');
const dailySheetController = require('./dailySheetController');
const { logUnitAssignment } = require('../services/unitAssignmentLogService');
const UnitAssignmentLogRange = require('../models/UnitAssignmentLogRange');

const isWithinDistance = (coord1, coord2, maxDistance) => {
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in kilometers

  return distance <= maxDistance;
};

const staffManagement = {
  addStaff: async (req, res) => {
    try {
      const {
        password,
        role,
        firstName,
        lastName,
        dateOfBirth,
        extraHourPrice,
        regularHours,
        hourPrice,
        AccountName,
        AccountNumber,
        SortNumber,
        username,
        csvPermission,
        email,
        phoneNumber,
        gender,
        CIN,
        designation,
        permissions,
        address,
        postcode,
        start_location,
        end_location,
        startLat,
        startLng,
        endLat,
        endLng,
      } = req.body;

      // Get file paths
      const pictureUrl = req.files['picture'] ? req.files['picture'][0].path : null;
      const driverLicenseUrl = req.files['DriverLicense'] ? req.files['DriverLicense'][0].path : null;
      const addressProofUrl = req.files['addressProof'] ? req.files['addressProof'][0].path : null;
      const natInsuranceUrl = req.files['NatInsurance'] ? req.files['NatInsurance'][0].path : null;
      const drivingLicenseFrontUrl = req.files['drivingLicenseFront'] ? req.files['drivingLicenseFront'][0].path : null;
      const drivingLicenseBackUrl = req.files['drivingLicenseBack'] ? req.files['drivingLicenseBack'][0].path : null;
      const rightToWorkShareCodeUrl = req.files['rightToWorkShareCode'] ? req.files['rightToWorkShareCode'][0].path : null;
      const passportUrl = req.files['passport'] ? req.files['passport'][0].path : null;
      const signedStarterFormUrl = req.files['signedStarterForm'] ? req.files['signedStarterForm'][0].path : null;

      if (!username || !email || !password || !role || !phoneNumber) {
        return res.status(400).json({
          message: 'Missing required fields: username, email, password, phoneNumber, and role are required.',
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      let newUser;

      if (role === 'Driver' || role === 'Helper') {
        const Model = role === 'Driver' ? Driver : Helper;
        const driverFields = {
          firstName,
          lastName,
          dateOfBirth,
          extraHourPrice,
          regularHours,
          hourPrice,
          AccountName,
          AccountNumber,
          SortNumber,
          username,
          csvPermission,
          email,
          phoneNumber,
          password: hashedPassword,
          role: [role],
          picture: pictureUrl,
          gender,
          CIN,
          designation,
          address,
          postcode,
          DriverLicense: driverLicenseUrl,
          drivingLicenseFront: drivingLicenseFrontUrl,
          drivingLicenseBack: drivingLicenseBackUrl,
          rightToWorkShareCode: rightToWorkShareCodeUrl,
          passport: passportUrl,
          signedStarterForm: signedStarterFormUrl,
          addressProof: addressProofUrl,
          NatInsurance: natInsuranceUrl,
        };
        if (role === 'Driver') {
          if (start_location && start_location.coordinates && start_location.coordinates.length >= 2) {
            driverFields.start_location = start_location;
          } else if (startLat != null && startLng != null) {
            driverFields.start_location = { type: 'Point', coordinates: [Number(startLng), Number(startLat)] };
          }
          if (end_location && end_location.coordinates && end_location.coordinates.length >= 2) {
            driverFields.end_location = end_location;
          } else if (endLat != null && endLng != null) {
            driverFields.end_location = { type: 'Point', coordinates: [Number(endLng), Number(endLat)] };
          }
        }
        newUser = new Model(driverFields);
      } else if (role === 'Admin') {
        const parsedPermissions =
          typeof permissions === 'string' ? JSON.parse(permissions) : permissions;
        newUser = new Admin({
          username,
          email,
          phoneNumber,
          password: hashedPassword,
          role: [role],
          picture: pictureUrl,
          gender,
          designation,
          CIN,
          address,
          postcode,
          DriverLicense: driverLicenseUrl,
          drivingLicenseFront: drivingLicenseFrontUrl,
          drivingLicenseBack: drivingLicenseBackUrl,
          rightToWorkShareCode: rightToWorkShareCodeUrl,
          passport: passportUrl,
          signedStarterForm: signedStarterFormUrl,
          addressProof: addressProofUrl,
          NatInsurance: natInsuranceUrl,
          permissions: parsedPermissions || {},
        });
      } else {
        newUser = new User({
          username,
          email,
          phoneNumber,
          password: hashedPassword,
          role: [role],
          picture: pictureUrl,
          gender,
          designation,
          address,
          postcode,
          DriverLicense: driverLicenseUrl,
          drivingLicenseFront: drivingLicenseFrontUrl,
          drivingLicenseBack: drivingLicenseBackUrl,
          rightToWorkShareCode: rightToWorkShareCodeUrl,
          passport: passportUrl,
          signedStarterForm: signedStarterFormUrl,
          addressProof: addressProofUrl,
          NatInsurance: natInsuranceUrl,
        });
      }
      console.log(newUser)
      await newUser.save();

      // Create a log of the staff creation
      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'CREATE',
        entityType: 'STAFF',
        entityId: newUser._id,
        changes: {
          created: newUser.toObject(),
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(201).json({ message: `${role} created successfully`, user: newUser });
    } catch (error) {
      console.error('Error in addStaff:', error);
      res.status(500).json({
        message: `Failed to create staff member`,
        error: error.message,
      });
    }
  },

  getAllStaff: async (req, res) => {
    try {
      const { page = 1, limit = 9, showAll = 'true', pagination = 'true' } = req.query;
      console.log(req.query)
      // Base filter
      let filter = {};
      if (!showAll) {
        filter.role = { $in: ['Driver', 'Helper'], $nin: ['Admin'] };
      }

      // Keyword search
      if (req.query.keyword) {
        const keyword = req.query.keyword.trim();
        filter.$or = [
          { username: { $regex: keyword, $options: 'i' } },
          { email: { $regex: keyword, $options: 'i' } },
          { phoneNumber: { $regex: keyword, $options: 'i' } },
        ];
      }

      // Count
      const total = await User.countDocuments(filter);

      // Sort
      let sort = req.query.sort
        ? req.query.sort.split(',').join(' ') + ' _id'
        : '-createdAt _id';

      // Query with conditional pagination
      let query = User.find(filter).sort(sort);

      if (pagination === 'true') {
        const currentPage = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (currentPage - 1) * limitNum;
        query = query.skip(skip).limit(limitNum);
      }

      const users = await query;

      // Trucks
      const userIds = users.map((user) => user._id);
      const trucks = await Truck.find({
        $or: [{ driverId: { $in: userIds } }, { helperId: { $in: userIds } }],
      }).select('name driverId helperId');

      const usersWithTrucks = users.map((user) => {
        const userTrucks = trucks.filter(
          (truck) =>
            truck.driverId?.toString() === user._id.toString() ||
            truck.helperId?.toString() === user._id.toString()
        );
        return { ...user.toObject(), trucks: userTrucks };
      });

      res.status(200).json({
        message: 'Staff retrieved successfully',
        users: usersWithTrucks,
        meta: {
          currentPage: pagination === 'true' ? parseInt(page, 10) : 1,
          limit: pagination === 'true' ? parseInt(limit, 10) : total,
          total,
          count: users.length,
          pagination: pagination === 'true'
        },
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve staff',
        error: error.message,
      });
    }
  },

  getStaffById: async (req, res) => {
    const { id } = req.params;
    try {
      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ message: 'Staff not found' });
      }
      res.status(200).json({ message: 'Staff retrieved successfully', user });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to retrieve staff', error: error.message });
    }
  },

  deleteStaff: async (req, res) => {
    const { id } = req.params;
    try {
      // Get the user data before deleting
      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ message: 'Staff not found' });
      }

      // Delete the user
      await User.findByIdAndDelete(id);

      // Create a log of the deletion
      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'DELETE',
        entityType: 'STAFF',
        entityId: id,
        changes: {
          deleted: user.toObject(),
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(200).json({ message: 'Staff deleted successfully' });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to delete staff', error: error.message });
    }
  },

  updateStaff: async (req, res) => {
    const { id } = req.params;
    let updateData = req.body; // Take all incoming fields for potential update
    console.log(updateData)
    try {
      // Get the old user data before updating to check role
      const oldUser = await User.findById(id);
      if (!oldUser) {
        return res.status(404).json({ message: 'Staff not found' });
      }

      // Normalize incoming types
      // Only parse permissions if the staff member is an Admin
      if (oldUser.roleType === 'Admin' && typeof updateData.permissions === 'string') {
        try {
          updateData.permissions = JSON.parse(updateData.permissions);
        } catch (e) {
          return res.status(400).json({ message: 'Invalid permissions format. Must be JSON.' });
        }
      }

      if (updateData.role && typeof updateData.role === 'string') {
        updateData.role = [updateData.role];
      }

      if (typeof updateData.csvPermission === 'string') {
        updateData.csvPermission = updateData.csvPermission === 'true';
      }

      // Handle empty phone number
      if (updateData.phoneNumber === '') {
        updateData.phoneNumber = null;
      }

      // Check if any files are included in the request and update their respective fields
      if (req.files) {
        if (req.files['picture']) updateData.picture = req.files['picture'][0].path;
        if (req.files['DriverLicense']) updateData.DriverLicense = req.files['DriverLicense'][0].path;
        if (req.files['addressProof']) updateData.addressProof = req.files['addressProof'][0].path;
        if (req.files['NatInsurance']) updateData.NatInsurance = req.files['NatInsurance'][0].path;
        if (req.files['drivingLicenseFront']) updateData.drivingLicenseFront = req.files['drivingLicenseFront'][0].path;
        if (req.files['drivingLicenseBack']) updateData.drivingLicenseBack = req.files['drivingLicenseBack'][0].path;
        if (req.files['rightToWorkShareCode']) updateData.rightToWorkShareCode = req.files['rightToWorkShareCode'][0].path;
        if (req.files['passport']) updateData.passport = req.files['passport'][0].path;
        if (req.files['signedStarterForm']) updateData.signedStarterForm = req.files['signedStarterForm'][0].path;
      }

      // If password is included, hash it before updating
      if (updateData.password && updateData.password.trim() !== '') {
        updateData.password = await bcrypt.hash(updateData.password, 10);
      }

      // Driver-only: build start_location / end_location from lat/lng if provided
      if (oldUser.roleType === 'Driver') {
        if (updateData.startLat != null && updateData.startLng != null) {
          updateData.start_location = {
            type: 'Point',
            coordinates: [Number(updateData.startLng), Number(updateData.startLat)],
          };
          delete updateData.startLat;
          delete updateData.startLng;
        }
        if (updateData.endLat != null && updateData.endLng != null) {
          updateData.end_location = {
            type: 'Point',
            coordinates: [Number(updateData.endLng), Number(updateData.endLat)],
          };
          delete updateData.endLat;
          delete updateData.endLng;
        }
      }

      // Choose correct discriminator model for update (ensures proper casting/validation)
      const Model = oldUser.roleType === 'Admin'
        ? Admin
        : oldUser.roleType === 'Driver'
          ? Driver
          : oldUser.roleType === 'Helper'
            ? Helper
            : User;

      // Update the staff member in the database (apply validators)
      const user = await Model.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true, runValidators: true },
      );

      // Create a log of the changes
      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'UPDATE',
        entityType: 'STAFF',
        entityId: id,
        changes: {
          before: oldUser.toObject(),
          after: user.toObject(),
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(200).json({ message: 'Staff updated successfully', user });
    } catch (error) {
      console.error('Error updating staff:', error);
      res.status(500).json({
        message: 'Failed to update staff',
        error: error.message,
      });
    }
  },

  assignDriverToTruck: async (req, res) => {
    const { driverId } = req.params;
    const { truckName, startAt } = req.body; // startAt = start date and time (ISO string or Date)

    try {
      const truck = await findTruckByTruckName(truckName);
      const driver = await Driver.findById(driverId);

      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      if (!driver) {
        return res.status(404).json({ message: 'Driver not found' });
      }

      if (truck.driverId) {
        return res
          .status(400)
          .json({ message: 'This truck already has a driver assigned' });
      }

      const startAtDate = startAt ? new Date(startAt) : new Date();
      if (isNaN(startAtDate.getTime())) {
        return res.status(400).json({ message: 'Invalid startAt date/time' });
      }

      // Prevent assigning the same driver to two trucks on the same time/day
      const driverConflict = await UnitAssignmentLogRange.findOne({
        type: 'driver',
        refId: driverId,
        startAt: { $lte: startAtDate },
        $or: [{ endAt: null }, { endAt: { $gte: startAtDate } }],
        truckId: { $ne: truck._id },
      }).populate('truckId', 'name');
      if (driverConflict) {
        return res.status(400).json({
          message: 'This driver is already assigned to another truck for this time period.',
          conflictTruck: driverConflict.truckId,
        });
      }

      truck.driverId = driverId;
      await truck.save();

      await logUnitAssignment({
        truckId: truck._id,
        type: 'driver',
        refId: driverId,
        event: 'assigned',
        by: req.user && req.user._id,
        startAt: startAtDate,
      });

      driver.truckId = truck._id;
      await driver.save();

      try {
        const dateStr = startAtDate.toISOString().split('T')[0];
        const mockReq = { body: { date: dateStr } };
        const mockRes = { status: () => ({ json: () => { } }), json: () => { } };
        await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
      } catch (dailySheetError) {
        console.error('Error updating daily sheets after driver assignment:', dailySheetError);
      }

      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'UPDATE',
        entityType: 'STAFF',
        entityId: driverId,
        changes: {
          assignment: {
            type: 'driver_to_truck',
            truckName,
            startAt: startAtDate,
            driverId,
            truckId: truck._id,
          },
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res
        .status(200)
        .json({ message: 'Driver assigned to truck successfully', truck });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to assign driver', error: error.message });
    }
  },

  assignHelperToTruck: async (req, res) => {
    const { helperId } = req.params;
    const { truckName, startAt } = req.body; // startAt = start date and time (ISO string or Date)

    try {
      const truck = await findTruckByTruckName(truckName);
      const helper = await User.findById(helperId);

      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      if (truck.helperId) {
        return res
          .status(400)
          .json({ message: 'This truck already has a helper assigned' });
      }

      const startAtDate = startAt ? new Date(startAt) : new Date();
      if (isNaN(startAtDate.getTime())) {
        return res.status(400).json({ message: 'Invalid startAt date/time' });
      }

      // Prevent assigning the same helper to two trucks on the same time/day
      const helperConflict = await UnitAssignmentLogRange.findOne({
        type: 'helper',
        refId: helperId,
        startAt: { $lte: startAtDate },
        $or: [{ endAt: null }, { endAt: { $gte: startAtDate } }],
        truckId: { $ne: truck._id },
      }).populate('truckId', 'name');
      if (helperConflict) {
        return res.status(400).json({
          message: 'This helper is already assigned to another truck for this time period.',
          conflictTruck: helperConflict.truckId,
        });
      }

      truck.helperId = helperId;
      await truck.save();

      await logUnitAssignment({
        truckId: truck._id,
        type: 'helper',
        refId: helperId,
        event: 'assigned',
        by: req.user && req.user._id,
        startAt: startAtDate,
      });

      helper.truckId = truck._id;
      await helper.save();

      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'UPDATE',
        entityType: 'STAFF',
        entityId: helperId,
        changes: {
          assignment: {
            type: 'helper_to_truck',
            truckName,
            startAt: startAtDate,
            helperId,
            truckId: truck._id,
          },
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res
        .status(200)
        .json({ message: 'Helper assigned to truck successfully', truck });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to assign helper', error: error.message });
    }
  },

  assignExtraDriverToTruck: async (req, res) => {
    const { driverId } = req.params;
    const { truckName, startDate, endDate } = req.body;

    try {
      const truck = await findTruckByTruckName(truckName);
      const driver = await Driver.findById(driverId);

      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      if (!driver) {
        return res.status(404).json({ message: 'Driver not found' });
      }

      // Check if driver is already assigned as extra
      const exists = truck.extraDrivers?.some(e => e.driverId && e.driverId.toString() === driverId);
      if (exists) {
        return res.status(400).json({ message: 'Driver already assigned as extra driver to this truck' });
      }

      // Check if driver is the primary driver
      if (truck.driverId && truck.driverId.toString() === driverId) {
        return res.status(400).json({ message: 'Driver is already the primary driver for this truck' });
      }

      truck.extraDrivers = truck.extraDrivers || [];
      truck.extraDrivers.push({
        driverId,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        assignedAt: new Date(),
      });
      await truck.save();

      driver.truckId = truck._id;
      await driver.save();

      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'UPDATE',
        entityType: 'STAFF',
        entityId: driverId,
        changes: {
          assignment: {
            type: 'extra_driver_to_truck',
            truckName,
            startDate,
            endDate,
            driverId,
            truckId: truck._id,
          },
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(200).json({ message: 'Extra driver assigned successfully', truck });
    } catch (error) {
      res.status(500).json({ message: 'Failed to assign extra driver', error: error.message });
    }
  },

  assignExtraHelperToTruck: async (req, res) => {
    const { helperId } = req.params;
    const { truckName, startDate, endDate } = req.body;

    try {
      const truck = await findTruckByTruckName(truckName);
      const helper = await Helper.findById(helperId);

      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      if (!helper) {
        return res.status(404).json({ message: 'Helper not found' });
      }

      // Check if helper is already assigned as extra
      const exists = truck.extraHelpers?.some(e => e.helperId && e.helperId.toString() === helperId);
      if (exists) {
        return res.status(400).json({ message: 'Helper already assigned as extra helper to this truck' });
      }

      // Check if helper is the primary helper
      if (truck.helperId && truck.helperId.toString() === helperId) {
        return res.status(400).json({ message: 'Helper is already the primary helper for this truck' });
      }

      truck.extraHelpers = truck.extraHelpers || [];
      truck.extraHelpers.push({
        helperId,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        assignedAt: new Date(),
      });
      await truck.save();

      helper.truckId = truck._id;
      await helper.save();

      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'UPDATE',
        entityType: 'STAFF',
        entityId: helperId,
        changes: {
          assignment: {
            type: 'extra_helper_to_truck',
            truckName,
            startDate,
            endDate,
            helperId,
            truckId: truck._id,
          },
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(200).json({ message: 'Extra helper assigned successfully', truck });
    } catch (error) {
      res.status(500).json({ message: 'Failed to assign extra helper', error: error.message });
    }
  },

  removeExtraDriverFromTruck: async (req, res) => {
    const { driverId } = req.params;
    const { truckName } = req.body;

    try {
      const truck = await findTruckByTruckName(truckName);
      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      if (!truck.extraDrivers || truck.extraDrivers.length === 0) {
        return res.status(400).json({ message: 'No extra drivers assigned to this truck' });
      }

      const initialLength = truck.extraDrivers.length;
      truck.extraDrivers = truck.extraDrivers.filter(
        e => e.driverId && e.driverId.toString() !== driverId
      );

      if (truck.extraDrivers.length === initialLength) {
        return res.status(400).json({ message: 'Driver not found in extra drivers list' });
      }

      await truck.save();

      const driver = await Driver.findById(driverId);
      if (driver) {
        driver.truckId = undefined;
        await driver.save();
      }

      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'UPDATE',
        entityType: 'STAFF',
        entityId: driverId,
        changes: {
          assignment: {
            type: 'remove_extra_driver_from_truck',
            truckName,
            driverId,
          },
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(200).json({ message: 'Extra driver removed successfully', truck });
    } catch (error) {
      res.status(500).json({ message: 'Failed to remove extra driver', error: error.message });
    }
  },

  removeExtraHelperFromTruck: async (req, res) => {
    const { helperId } = req.params;
    const { truckName } = req.body;

    try {
      const truck = await findTruckByTruckName(truckName);
      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      if (!truck.extraHelpers || truck.extraHelpers.length === 0) {
        return res.status(400).json({ message: 'No extra helpers assigned to this truck' });
      }

      const initialLength = truck.extraHelpers.length;
      truck.extraHelpers = truck.extraHelpers.filter(
        e => e.helperId && e.helperId.toString() !== helperId
      );

      if (truck.extraHelpers.length === initialLength) {
        return res.status(400).json({ message: 'Helper not found in extra helpers list' });
      }

      await truck.save();

      const helper = await Helper.findById(helperId);
      if (helper) {
        helper.truckId = undefined;
        await helper.save();
      }

      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'UPDATE',
        entityType: 'STAFF',
        entityId: helperId,
        changes: {
          assignment: {
            type: 'remove_extra_helper_from_truck',
            truckName,
            helperId,
          },
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(200).json({ message: 'Extra helper removed successfully', truck });
    } catch (error) {
      res.status(500).json({ message: 'Failed to remove extra helper', error: error.message });
    }
  },

  deassignDriverFromTruck: async (req, res) => {
    const { driverId } = req.params;
    const { truckName, endAt } = req.body; // endAt = end date and time (ISO string or Date)

    try {
      const truck = await findTruckByTruckName(truckName);

      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      if (truck.driverId.toString() !== driverId) {
        return res.status(400).json({
          message: 'This driver is not assigned to the specified truck',
        });
      }

      const endAtDate = endAt ? new Date(endAt) : new Date();
      if (isNaN(endAtDate.getTime())) {
        return res.status(400).json({ message: 'Invalid endAt date/time' });
      }

      truck.driverId = undefined;
      await truck.save();

      await logUnitAssignment({
        truckId: truck._id,
        type: 'driver',
        refId: driverId,
        event: 'deassigned',
        by: req.user && req.user._id,
        endAt: endAtDate,
      });

      const driver = await Driver.findById(driverId);
      if (driver) {
        driver.designation = undefined;
        driver.truckId = undefined;
        await driver.save();
      }

      // Create a log of the driver deassignment
      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'UPDATE',
        entityType: 'STAFF',
        entityId: driverId,
        changes: {
          deassignment: {
            type: 'driver_from_truck',
            truckName,
            driverId,
            truckId: truck._id,
          },
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res
        .status(200)
        .json({ message: 'Driver deassigned from truck successfully', truck });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to deassign driver', error: error.message });
    }
  },

  deassignHelperFromTruck: async (req, res) => {
    const { helperId } = req.params;
    const { truckName, endAt } = req.body; // endAt = end date and time (ISO string or Date)

    try {
      const truck = await findTruckByTruckName(truckName);

      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      if (truck.helperId.toString() !== helperId) {
        return res.status(400).json({
          message: 'This helper is not assigned to the specified truck',
        });
      }

      const endAtDate = endAt ? new Date(endAt) : new Date();
      if (isNaN(endAtDate.getTime())) {
        return res.status(400).json({ message: 'Invalid endAt date/time' });
      }

      truck.helperId = undefined;
      await truck.save();

      await logUnitAssignment({
        truckId: truck._id,
        type: 'helper',
        refId: helperId,
        event: 'deassigned',
        by: req.user && req.user._id,
        endAt: endAtDate,
      });

      const helper = await Helper.findById(helperId);
      if (helper) {
        helper.designation = undefined;
        helper.truckId = undefined;
        await helper.save();
      }

      // Create a log of the helper deassignment
      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'UPDATE',
        entityType: 'STAFF',
        entityId: helperId,
        changes: {
          deassignment: {
            type: 'helper_from_truck',
            truckName,
            helperId,
            truckId: truck._id,
          },
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res
        .status(200)
        .json({ message: 'Helper deassigned from truck successfully', truck });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to deassign helper', error: error.message });
    }
  },

  updateDriverLocation: async (req, res) => {
    const { driverId } = req.params;
    const { latitude, longitude } = req.body;

    try {
      const driver = await Driver.findById(driverId);
      if (!driver) {
        return res.status(404).json({ message: 'Driver not found' });
      }

      // Update driver's current location
      driver.location = { type: 'Point', coordinates: [longitude, latitude] };

      // Find the assigned helper by the truck's helperId
      const truck = await Truck.findOne({ driverId: driverId });

      if (!truck || !truck.helperId) {
        return res
          .status(404)
          .json({ message: 'No helper assigned to this truck' });
      }

      const helper = await Helper.findById(truck.helperId);
      if (helper && helper.location) {
        const helperLocation = [longitude, latitude]; // Assuming helper's location is in similar format

        // Check if the driver is within 0.1 km of the helper
        const maxDistance = 0.1; // Distance in kilometers
        if (
          isWithinDistance(
            driver.location.coordinates,
            helperLocation,
            maxDistance,
          )
        ) {
          if (!driver.startTime) {
            // Start time is not already set
            driver.startTime = new Date(); // Record the start time
          }
        }
      }

      await driver.save();

      // Emit the new driver location to all connected clients
      socket.emitEvent('driverLocationUpdate', {
        driverId,
        latitude,
        longitude,
      });

      res.status(200).json({ message: 'Location updated successfully' });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to update location', error: error.message });
    }
  },

  getTasksForDriver: async (req, res) => {
    const driverId = req.params; // ID of the driver from URL

    try {
      // Find the truck that this driver is assigned to
      const truck = await Truck.findOne({ driverId: driverId });
      if (!truck) {
        return res
          .status(404)
          .json({ message: 'No truck found for the given driver.' });
      }

      // Retrieve all tasks associated with this truck
      const tasks = await Task.find({ _id: { $in: truck.tasks } });
      res.status(200).json({ message: 'Tasks retrieved successfully', tasks });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to retrieve tasks', error: error.message });
    }
  },

  updateAdminProfile: async (req, res) => {
    const adminId = req.user._id;
    const updatedData = req.body;

    if (req.file) {
      updatedData.picture = req.file.path;
    }

    // Check if admin exists
    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    if (updatedData.currentPassword && updatedData.newPassword && updatedData.confirmNewPassword) {
      if (!updatedData.currentPassword) {
        return res.status(400).json({ message: 'Current password is required' });
      }

      // Compare the current password with the password in the database
      const isMatch = await bcrypt.compare(updatedData.currentPassword, admin.password);

      if (!isMatch) {
        return res.status(400).json({ message: 'Invalid password' });
      }

      // Check if passwords match
      if (updatedData.newPassword !== updatedData.confirmNewPassword) {
        return res.status(400).json({ message: 'Passwords do not match' });
      }

      // Update password if new password is provided
      if (updatedData.newPassword && updatedData.newPassword.trim() !== '') {
        updatedData.password = await bcrypt.hash(updatedData.newPassword, 10);
        delete updatedData.newPassword;
        delete updatedData.confirmNewPassword;
      }
    }

    // Get the old admin data before updating
    const oldAdmin = await Admin.findById(adminId);
    if (!oldAdmin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const updatedAdmin = await Admin.findByIdAndUpdate(adminId, updatedData, {
      new: true,
    });

    // Create a log of the admin profile update
    await loggingService.createLog({
      userId: req.user._id,
      username: req.user.username,
      action: 'UPDATE',
      entityType: 'STAFF',
      entityId: adminId,
      changes: {
        before: oldAdmin.toObject(),
        after: updatedAdmin.toObject(),
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(200).json({
      message: 'Admin profile updated successfully',
      admin: updatedAdmin,
    });

    try {
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update admin profile',
        error: error.message,
      });
    }
  },

  optimizeTasks: async (req, res) => {
    try {
      const { truckId } = req.params;
      const { date } = req.body; //example  "2024-12-03"
      console.log(truckId)
      const response = await optimizeRoute(truckId, date);
      res.json({ response: response })
    } catch (error) {
      console.log(error)
      res.json({ error: error })
    }
  },

  updateEmailSignature: async (req, res) => {
    try {
      const { signature } = req.body;
      const adminId = req.user._id;

      const admin = await Admin.findById(adminId);
      if (!admin) {
        return res.status(404).json({ message: 'Admin not found' });
      }

      // Get the old signature before updating
      const oldSignature = admin.emailSignature;

      admin.emailSignature = signature;
      await admin.save();

      // Create a log of the email signature update
      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'UPDATE',
        entityType: 'STAFF',
        entityId: adminId,
        changes: {
          emailSignature: {
            before: oldSignature,
            after: signature,
          },
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(200).json({
        message: 'Email signature updated successfully',
        signature: admin.emailSignature
      });
    } catch (error) {
      console.error('Error updating email signature:', error);
      res.status(500).json({
        message: 'Failed to update email signature',
        error: error.message
      });
    }
  },

  logoutUserFromAllDevices: async (req, res) => {
    const { userId } = req.params;

    try {
      // Check if admin is trying to log out themselves
      if (req.user._id.toString() === userId) {
        return res.status(400).json({
          message: 'You cannot log yourself out. Please use the logout endpoint.',
        });
      }

      // Find the user to log out
      const userToLogout = await User.findById(userId);
      if (!userToLogout) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Clear refresh token
      userToLogout.refreshToken = undefined;

      // Clear all devices
      userToLogout.devices = [];

      // Clear OneSignal player IDs
      userToLogout.oneSignalPlayerIds = [];
      userToLogout.oneSignalPlayerId = undefined;
      userToLogout.oneSignalWebPlayerIds = [];
      userToLogout.oneSignalWebPlayerId = undefined;

      // Clear FCM and APNS tokens
      userToLogout.fcmToken = undefined;
      userToLogout.apnsToken = undefined;

      await userToLogout.save();

      // Get socket instance and emit logout event before disconnecting
      const { getIo, disconnectUser } = require('../socket');
      let disconnected = false;

      try {
        const io = getIo();
        if (io) {
          // Find and emit to user's socket(s) before disconnecting
          const userIdStr = userId.toString();
          const sockets = io.sockets.sockets;

          for (const [socketId, socket] of sockets) {
            if (socket.user && socket.user.userId && socket.user.userId.toString() === userIdStr) {
              // Emit custom logout event to notify the user
              socket.emit('forceLogout', {
                message: 'You have been logged out from all devices by an administrator.',
                timestamp: new Date(),
              });
            }
          }

          // Small delay to ensure message is sent before disconnect
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (socketError) {
        console.error('Error emitting logout event:', socketError);
      }

      // Disconnect user from socket connections
      try {
        disconnected = disconnectUser(userId);
      } catch (disconnectError) {
        console.error('Error disconnecting user from socket:', disconnectError);
      }

      // Create a log of the logout action
      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'LOGOUT',
        entityType: 'USER',
        entityId: userId,
        changes: {
          loggedOutBy: {
            adminId: req.user._id,
            adminUsername: req.user.username,
            targetUserId: userId,
            targetUsername: userToLogout.username,
            disconnectedFromSocket: disconnected,
          },
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(200).json({
        message: 'User logged out from all devices successfully',
        disconnectedFromSocket: disconnected,
        user: {
          id: userToLogout._id,
          username: userToLogout.username,
          email: userToLogout.email,
        },
      });
    } catch (error) {
      console.error('Error logging out user from all devices:', error);
      res.status(500).json({
        message: 'Failed to log out user from all devices',
        error: error.message,
      });
    }
  }
};

module.exports = staffManagement;
