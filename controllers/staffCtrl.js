const { User } = require("../models/User");
const Driver = require("../models/Driver");
const Helper = require("../models/Helper");
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
    console.log('Request Body:', req.body);  // Log to see what you actually received
  
    try {
      const {
        password, role, username, email, phoneNumber
      } = req.body;
      const pictureUrl = req.file ? req.file.path : null;
  
      if (!username || !email || !password || !role || !phoneNumber) {
        return res.status(400).json({ message: "Missing required fields: username, email, password, phoneNumber, and role are required." });
      }
  
      const hashedPassword = await bcrypt.hash(password, 10);
      let newUser;
  
      if (role === 'Driver' || role === 'Helper') {
        const Model = role === 'Driver' ? Driver : Helper;
        newUser = new Model({
          username,
          email,
          phoneNumber,
          password: hashedPassword,
          role: [role],
          picture: pictureUrl
        });
      } else {
        newUser = new User({
          username,
          email,
          phoneNumber,
          password: hashedPassword,
          role: [role],
          picture: pictureUrl
        });
      }
      await newUser.save();
      res.status(201).json({ message: `${role} created successfully`, user: newUser });
    } catch (error) {
      console.error('Error in addStaff:', error);
      res.status(500).json({ message: `Failed to create staff member`, error: error.message });
    }
  },
  
  getAllStaff: async (req, res) => {
    try {
      // Simple fetch of all users without populating any references
      const users = await User.find();
      res.status(200).json({ message: "Staff retrieved successfully", users });
    } catch (error) {
      res.status(500).json({ message: "Failed to retrieve staff", error: error.message });
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
      res.status(500).json({ message: "Failed to retrieve staff", error: error.message });
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
      res.status(500).json({ message: "Failed to delete staff", error: error.message });
    }
  },

  updateStaff: async (req, res) => {
    const { id } = req.params;
    let updateData = req.body; // Take all incoming fields for potential update
  
    // If password is included, hash it before updating
    if (updateData.password) {
      updateData.password = await bcrypt.hash(updateData.password, 10);
    }
  
    try {
      const user = await User.findByIdAndUpdate(id, { $set: updateData }, { new: true });
      if (!user) {
        return res.status(404).json({ message: "Staff not found" });
      }
      res.status(200).json({ message: "Staff updated successfully", user });
    } catch (error) {
      console.error('Error updating staff:', error);
      res.status(500).json({ message: "Failed to update staff", error: error.message });
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
    driver.designation = truckName;  // You may need to adjust this if you want to append or modify the existing designation
    await driver.save();
   
      res.status(200).json({ message: "Driver assigned to truck successfully", truck });
  } catch (error) {
      res.status(500).json({ message: "Failed to assign driver", error: error.message });
  }
},

assignHelperToTruck: async (req, res) => {
  const { helperId } = req.params; 
  const { truckName } = req.body; 

  try {
     
      const truck = await Truck.findOne({ name: truckName });
      if (!truck) {
          return res.status(404).json({ message: "Truck not found" });
      }

      truck.helperId = helperId;
      await truck.save();

      res.status(200).json({ message: "Helper assigned to truck successfully", truck });
  } catch (error) {
      res.status(500).json({ message: "Failed to assign helper", error: error.message });
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
      return res.status(404).json({ message: "No helper assigned to this truck" });
    }

    const helper = await Helper.findById(truck.helperId);
    if (helper && helper.location) {
      const helperLocation = [longitude, latitude]; // Assuming helper's location is in similar format

      // Check if the driver is within 0.1 km of the helper
      const maxDistance = 0.1; // Distance in kilometers
      if (isWithinDistance(driver.location.coordinates, helperLocation, maxDistance)) {
        if (!driver.startTime) { // Start time is not already set
          driver.startTime = new Date(); // Record the start time
        }
      }
    }

    await driver.save();

    // Emit the new driver location to all connected clients
    socket.emitEvent("driverLocationUpdate", { driverId, latitude, longitude });

    res.status(200).json({ message: "Location updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update location", error: error.message });
  }
},

getTasksForDriver : async (req, res) => {
  const driverId = req.params;   // ID of the driver from URL

  try {
    // Find the truck that this driver is assigned to
    const truck = await Truck.findOne({ driverId: driverId });
    if (!truck) {
      return res.status(404).json({ message: "No truck found for the given driver." });
    }

    // Retrieve all tasks associated with this truck
    const tasks = await Task.find({ '_id': { $in: truck.tasks } });
    res.status(200).json({ message: "Tasks retrieved successfully", tasks });
  } catch (error) {
    res.status(500).json({ message: "Failed to retrieve tasks", error: error.message });
  }
},
};

module.exports = staffManagement;
