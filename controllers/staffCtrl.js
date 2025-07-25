const { User } = require('../models/User');
const Driver = require('../models/Driver');
const Helper = require('../models/Helper');
const Admin = require('../models/Admin');
const Truck = require('../models/Truck');
const bcrypt = require('bcrypt');
const socket = require('../socket'); // Ensure you have the correct path to your socket module
const APIfeatures = require('../utils/APIFeatures');
const { optimizeRoute } = require('../helper/OpitomRoute');

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
      } = req.body;

      // Get file paths
      const pictureUrl = req.files['picture'] ? req.files['picture'][0].path : null;
      const driverLicenseUrl = req.files['DriverLicense'] ? req.files['DriverLicense'][0].path : null;
      const addressProofUrl = req.files['addressProof'] ? req.files['addressProof'][0].path : null;
      const natInsuranceUrl = req.files['NatInsurance'] ? req.files['NatInsurance'][0].path : null;

      if (!username || !email || !password || !role || !phoneNumber) {
        return res.status(400).json({
          message: 'Missing required fields: username, email, password, phoneNumber, and role are required.',
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      let newUser;

      if (role === 'Driver' || role === 'Helper') {
        const Model = role === 'Driver' ? Driver : Helper;
        newUser = new Model({
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
          DriverLicense: driverLicenseUrl,
          addressProof: addressProofUrl,
          NatInsurance: natInsuranceUrl,
        });
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
          DriverLicense: driverLicenseUrl,
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
          DriverLicense: driverLicenseUrl,
          addressProof: addressProofUrl,
          NatInsurance: natInsuranceUrl,
        });
      }
      console.log(newUser)
      await newUser.save();
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
      const { page = 1, limit = 9, showAll='true' , pagination = 'true' } = req.query;
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
      }).select('name driverId helperId driverSpecificDays helperSpecificDays');
  
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
      const user = await User.findByIdAndDelete(id);
      if (!user) {
        return res.status(404).json({ message: 'Staff not found' });
      }
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
      // Handle empty phone number
      if (updateData.phoneNumber === '') {
        updateData.phoneNumber = null;
      }

      // Check if any files are included in the request and update their respective fields
      if (req.files) {
        updateData.picture = req.files['picture'] ? req.files['picture'][0].path : undefined;
        updateData.DriverLicense = req.files['DriverLicense'] ? req.files['DriverLicense'][0].path : undefined;
        updateData.addressProof = req.files['addressProof'] ? req.files['addressProof'][0].path : undefined;
        updateData.NatInsurance = req.files['NatInsurance'] ? req.files['NatInsurance'][0].path : undefined;
      }

      // If password is included, hash it before updating
      if (updateData.password && updateData.password.trim() !== '') {
        updateData.password = await bcrypt.hash(updateData.password, 10);
      }

      // Update the staff member in the database
      const user = await User.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true }, // Return the updated document
      );

      if (!user) {
        return res.status(404).json({ message: 'Staff not found' });
      }

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
    const { truckName, startDate, endDate } = req.body; // Accept start and end dates

    try {
      const truck = await Truck.findOne({ name: truckName });
      const driver = await Driver.findById(driverId);

      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      // Check if the truck already has a driver assigned
      if (truck.driverId) {
        return res
          .status(400)
          .json({ message: 'This truck already has a driver assigned' });
      }

      // Assign driver to truck
      truck.driverId = driverId;

      // Set the specific days for the driver
      truck.driverSpecificDays = {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      };

      await truck.save();

      // Update the driver's designation with the truck name
      driver.designation = truckName; // Adjust as needed
      await driver.save();

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
    const { truckName, startDate, endDate } = req.body; // Accept start and end dates

    try {
      const truck = await Truck.findOne({ name: truckName });
      const helper = await Helper.findById(helperId);

      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      // Check if the truck already has a helper assigned
      if (truck.helperId) {
        return res
          .status(400)
          .json({ message: 'This truck already has a helper assigned' });
      }

      // Assign helper to truck
      truck.helperId = helperId;

      // Set the specific days for the helper
      truck.helperSpecificDays = {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      };

      await truck.save();

      // Update the helper's designation with the truck name
      helper.designation = truckName; // Adjust as needed
      await helper.save();

      res
        .status(200)
        .json({ message: 'Helper assigned to truck successfully', truck });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to assign helper', error: error.message });
    }
  },

  deassignDriverFromTruck: async (req, res) => {
    const { driverId } = req.params;
    const { truckName } = req.body;

    try {
      const truck = await Truck.findOne({ name: truckName });

      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      if (truck.driverId.toString() !== driverId) {
        return res.status(400).json({
          message: 'This driver is not assigned to the specified truck',
        });
      }

      truck.driverId = undefined;
      truck.driverSpecificDays = undefined;

      await truck.save();

      const driver = await Driver.findById(driverId);
      if (driver) {
        driver.designation = undefined;
        await driver.save();
      }

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
    const { truckName } = req.body;

    try {
      const truck = await Truck.findOne({ name: truckName });

      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      if (truck.helperId.toString() !== helperId) {
        return res.status(400).json({
          message: 'This helper is not assigned to the specified truck',
        });
      }

      truck.helperId = undefined;
      truck.helperSpecificDays = undefined;

      await truck.save();

      const helper = await Helper.findById(helperId);
      if (helper) {
        helper.designation = undefined;
        await helper.save();
      }

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

    const updatedAdmin = await Admin.findByIdAndUpdate(adminId, updatedData, {
      new: true,
    });

    if (!updatedAdmin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

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

      admin.emailSignature = signature;
      await admin.save();

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
  }
};

module.exports = staffManagement;
