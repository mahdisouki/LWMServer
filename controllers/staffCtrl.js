const { User } = require("../models/User");
const Driver = require("../models/Driver");
const Helper = require("../models/Helper");
const Admin = require("../models/Admin")
const Truck = require("../models/Truck");
const bcrypt = require("bcrypt");
const socket = require("../socket"); // Ensure you have the correct path to your socket module

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
        username,
        email,
        phoneNumber,
        gender,
        designation,
      } = req.body;
      const pictureUrl = req.file ? req.file.path : null;

      if (!username || !email || !password || !role || !phoneNumber) {
        return res.status(400).json({
          message:
            "Missing required fields: username, email, password, phoneNumber, and role are required.",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      let newUser;

      if (role === "Driver" || role === "Helper") {
        const Model = role === "Driver" ? Driver : Helper;
        newUser = new Model({
          username,
          email,
          phoneNumber,
          password: hashedPassword,
          role: [role],
          picture: pictureUrl,
          gender,
          designation,
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
        });
      }
      await newUser.save();
      res
        .status(201)
        .json({ message: `${role} created successfully`, user: newUser });
    } catch (error) {
      console.error("Error in addStaff:", error);
      res.status(500).json({
        message: `Failed to create staff member`,
        error: error.message,
      });
    }
  },

  getAllStaff: async (req, res) => {
    try {
      const { page, limit, filters } = req.query;

      let query = User.find({
        role: { $in: ["Driver", "Helper"], $nin: ["Admin"] },
      });

      if (filters) {
        query = query.find(filters);
      }

      const total = await User.countDocuments(query);
      const users = await query
        .skip((page - 1) * limit)
        .limit(limit)
        .exec();

      res.status(200).json({
        message: "Staff retrieved successfully",
        users,
        meta: {
          currentPage: Number(page),
          limit: Number(limit),
          total,
          count: users.length,
        },
      });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve staff", error: error.message });
    }
  },

  getStaffById: async (req, res) => {
    const { id } = req.params;
    try {
      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ message: "Staff not found" });
      }
      res.status(200).json({ message: "Staff retrieved successfully", user });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve staff", error: error.message });
    }
  },

  deleteStaff: async (req, res) => {
    const { id } = req.params;
    try {
      const user = await User.findByIdAndDelete(id);
      if (!user) {
        return res.status(404).json({ message: "Staff not found" });
      }
      res.status(200).json({ message: "Staff deleted successfully" });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to delete staff", error: error.message });
    }
  },

  updateStaff: async (req, res) => {
    const { id } = req.params;
    let updateData = req.body; // Take all incoming fields for potential update

    if (req.file) {
      updateData.picture = req.file.path; // Save or update the path to the file in the database
    }

    // If password is included, hash it before updating
    if (updateData.password && updateData.password.trim() !== "") {
      updateData.password = await bcrypt.hash(updateData.password, 10);
    }

    try {
      const user = await User.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true }
      );
      if (!user) {
        return res.status(404).json({ message: "Staff not found" });
      }
      res.status(200).json({ message: "Staff updated successfully", user });
    } catch (error) {
      console.error("Error updating staff:", error);
      res
        .status(500)
        .json({ message: "Failed to update staff", error: error.message });
    }
  },

  assignDriverToTruck: async (req, res) => {
    const { driverId } = req.params;
    const { truckName } = req.body;

    try {
      const truck = await Truck.findOne({ name: truckName });
      const driver = await Driver.findById(driverId);
      if (!truck) {
        return res.status(404).json({ message: "Truck not found" });
      }

      truck.driverId = driverId;
      await truck.save();
      // Find the driver by ID

      // Update the driver's designation with the truck name
      driver.designation = truckName; // You may need to adjust this if you want to append or modify the existing designation
      await driver.save();

      res
        .status(200)
        .json({ message: "Driver assigned to truck successfully", truck });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to assign driver", error: error.message });
    }
  },

  assignHelperToTruck: async (req, res) => {
    const { helperId } = req.params;
    const { truckName } = req.body;

    try {
      const truck = await Truck.findOne({ name: truckName });
      const helper = await Helper.findById(helperId);
      if (!truck) {
        return res.status(404).json({ message: "Truck not found" });
      }

      truck.helperId = helperId;
      await truck.save();

      helper.designation = truckName;
      await helper.save();

      res
        .status(200)
        .json({ message: "Helper assigned to truck successfully", truck });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to assign helper", error: error.message });
    }
  },

  updateDriverLocation: async (req, res) => {
    const { driverId } = req.params;
    const { latitude, longitude } = req.body;

    try {
      const driver = await Driver.findById(driverId);
      if (!driver) {
        return res.status(404).json({ message: "Driver not found" });
      }

      // Update driver's current location
      driver.location = { type: "Point", coordinates: [longitude, latitude] };

      // Find the assigned helper by the truck's helperId
      const truck = await Truck.findOne({ driverId: driverId });

      if (!truck || !truck.helperId) {
        return res
          .status(404)
          .json({ message: "No helper assigned to this truck" });
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
            maxDistance
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
      socket.emitEvent("driverLocationUpdate", {
        driverId,
        latitude,
        longitude,
      });

      res.status(200).json({ message: "Location updated successfully" });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to update location", error: error.message });
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
          .json({ message: "No truck found for the given driver." });
      }

      // Retrieve all tasks associated with this truck
      const tasks = await Task.find({ _id: { $in: truck.tasks } });
      res.status(200).json({ message: "Tasks retrieved successfully", tasks });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve tasks", error: error.message });
    }
  },
  updateAdminProfile : async (req, res) => {
    try {
      const adminId = req.user._id; // Get the user ID from req.user
  
      const updatedData = req.body; // Assuming the request body contains the profile data to update
  
      // Update the admin profile using the id
      const updatedAdmin = await Admin.findByIdAndUpdate(adminId, updatedData, {
        new: true, // Return the updated document
      });
  
      if (!updatedAdmin) {
        return res.status(404).json({ message: "Admin not found" });
      }
  
      res.status(200).json({
        message: "Admin profile updated successfully",
        admin: updatedAdmin,
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to update admin profile",
        error: error.message,
      });
    }
  }
};

module.exports = staffManagement;
