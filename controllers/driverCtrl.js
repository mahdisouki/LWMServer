const { User } = require("../models/User");
const { Helper } = require("../models/Helper");
const Task = require("../models/Task");
const Truck = require("../models/Truck");
const TruckStatus = require("../models/TruckStatus");
const bcrypt = require("bcrypt");

const driverManagement = {
updateDriverProfile: async (req, res) => {
    const driverId = req.user._id; 
    const { email, officialEmail, phoneNumber, username, gender, designation, dateOfBirth, picture, password } = req.body;

    try {
        const driver = await User.findById(driverId);

        if (!driver) {
            return res.status(404).json({ message: "Driver not found" });
        }

        // Update fields if provided
        if (email) driver.email = email;
        if (officialEmail) driver.officialEmail = officialEmail;
        if (phoneNumber) driver.phoneNumber = phoneNumber;
        if (username) driver.username = username;
        if (gender) driver.gender = gender;
        if (designation) driver.designation = designation;
        if (dateOfBirth) driver.dateOfBirth = dateOfBirth;
        if (password) driver.password = await bcrypt.hash(password, 10);
      
        // The picture URL is automatically set by the Cloudinary middleware
        if (req.file) {
            driver.picture = req.file.path;  // This should be adjusted if `req.file.path` does not correctly point to the image URL
        }

        await driver.save();
        
        res.status(200).json({ message: "Driver profile updated successfully", user: { username: driver.username, email: driver.email, role: driver.role, id: driver._id, picture: driver.picture, phoneNumber: driver.phoneNumber[0] } });
    } catch (error) {
        console.error("Error updating driver profile:", error);
        res.status(500).json({ message: "Failed to update driver profile", error: error.message });
    }
},

getHelperLocationForDriver: async (req, res) => {
  const driverId = req.user._id;

  try {
    // Find the truck assigned to this driver
    const truck = await Truck.findOne({ driverId: driverId });

    if (!truck) {
      return res.status(404).json({ message: "No truck found for the given driver." });
    }

    // Check if a helper is assigned to the truck
    if (!truck.helperId) {
      return res.status(404).json({ message: "No helper assigned to this truck" });
    }

    // Fetch the helper using helperId from the truck
    const helper = await Helper.findById(truck.helperId);
    if (!helper) {
      return res.status(404).json({ message: "Helper not found" });
    }

    if (!helper.location) {
      return res.status(404).json({ message: "Location for this helper is not set" });
    }

    res.status(200).json({ message: "Helper location retrieved successfully", location: helper.location });
  } catch (error) {
    res.status(500).json({ message: "Failed to retrieve helper location", error: error.message });
  }
},

getTasksForDriver : async (req, res) => {
        const driverId = req.user._id;   // ID of the driver from URL
        const trucks = await Truck.find();

        trucks.forEach(async (truck) => {
            truck.driverId = driverId;
            await truck.save();
        });
      
        try {
          // Find the truck that this driver is assigned to
          const truck = await Truck.findOne({ driverId: driverId });

          if (!truck) {
            return res.status(404).json({ message: "No truck found for the given driver." });
          }

        

          // Retrieve all tasks associated with this truck
          // TODO: Filter tasks by truck ID - FIX THIS
          //const tasks = await Task.find({ '_id': { $in: truck.tasks } });
          const tasks = await Task.find();
          console.log(tasks);
          res.status(200).json({ message: "Tasks retrieved successfully", tasks });
        } catch (error) {
          res.status(500).json({ message: "Failed to retrieve tasks", error: error.message });
        }
},
    
updateTruckStart : async (req, res) => {
          const { truckId } = req.params;
          const { fuelLevel, mileageStart } = req.body;
          const uploads = req.files.map(file => file.path); // Chemins d'accès des images stockées par Cloudinary
      
          try {
              const statusUpdate = {
                  truckId,
                  pictureBefore: uploads,
                  fuelLevel,
                  mileageStart
              };
      
              const truckStatus = await TruckStatus.findOneAndUpdate(
                  { truckId },
                  statusUpdate,
                  { new: true, upsert: true } // Crée un nouveau document si aucun n'existe
              );
      
              res.status(200).json({ message: "Truck start status updated successfully", truckStatus });
          } catch (error) {
              res.status(500).json({ message: "Failed to update truck start status", error: error.message });
          }
 
},

updateTruckEnd : async (req, res) => {
  const { truckId } = req.params;
  const { fuelLevelBefore,fuelLevelAfter, mileageEnd } = req.body;
  const uploads = req.files.map(file => file.path); // Chemins d'accès des images stockées par Cloudinary

  try {
      const statusUpdate = {
          truckId,
          pictureAfter: uploads,
          fuelLevelBefore,
          fuelLevelAfter,
          mileageEnd
      };

      const truckStatus = await TruckStatus.findOneAndUpdate(
          { truckId },
          statusUpdate,
          { new: true }
      );

      res.status(200).json({ message: "Truck end status updated successfully", truckStatus });
  } catch (error) {
      res.status(500).json({ message: "Failed to update truck end status", error: error.message });
  }
},

uploadInitialConditionPhotos : async (req, res) => {
    const { taskId } = req.params;
    const description = req.body.description; // Single description for all uploaded files
    const uploads = req.files.map(file => file.path); // Collecting file paths
    console.log(req.body);

    try {
        const taskUpdate = {
            initialConditionPhotos: [{
                items: uploads,
                description: description
            }]
        };

        const task = await Task.findByIdAndUpdate(
            taskId,
            taskUpdate,
            { new: true } // Update the task document
        );

        res.status(200).json({ message: "Initial condition photos uploaded successfully", task });
    } catch (error) {
        res.status(500).json({ message: "Failed to upload initial condition photos", error: error.message });
    }
},

uploadFinalConditionPhotos : async (req, res) => {
    const { taskId } = req.params;
    const description = req.body.description;
    const uploads = req.files.map(file => file.path);


   // console.log(uploads);

    try {
        const taskUpdate = {
            finalConditionPhotos: [{
                items: uploads,  // This should be an array of strings
                description: description
            }]
        };

        const task = await Task.findByIdAndUpdate(
            taskId,
            taskUpdate,
            { new: true }
        );

        res.status(200).json({ message: "Final condition photos uploaded successfully", task });
    } catch (error) {
        res.status(500).json({ message: "Failed to upload final condition photos", error: error.message });
    }
},

addAdditionalItems : async (req, res) => {
    const { taskId } = req.params; // Ensure your route is set to capture this
  
    const description = req.body.description; // Single description for all uploads
    const uploads = req.files.map(file => file.path); // Array of image URLs
    try {
        const taskUpdate = {
            additionalItems: [{
                items: uploads,
                description: description
            }]
        };

        const task = await Task.findByIdAndUpdate(
            taskId,
            taskUpdate,
            { new: true } // Ensures the updated document is returned
        );

        res.status(200).json({ message: "Additional items added successfully", task });
    } catch (error) {
        res.status(500).json({ message: "Failed to add additional items", error: error.message });
    }
},

updateJobStatus: async (req, res) => {
    const { taskId } = req.params;
    const { taskStatus } = req.body; // Assuming the new status is passed in the body of the request

    try {
        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        // Update the task status
        task.taskStatus = taskStatus;
        await task.save();
        res.status(200).json({ message: "Task status updated successfully", task });
    } catch (error) {
        console.error("Error updating task status:", error);
        res.status(500).json({ message: "Failed to update task status", error: error.message });
    }
},

rateTask: async (req, res) => {
    const { taskId } = req.params;
    const { clientFeedback } = req.body; // Assuming satisfaction rating and feedback are sent in the body

    try {
        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }
        // Update task with the client satisfaction rating and feedback
        task.clientFeedback = clientFeedback;
       
        await task.save();
        res.status(200).json({ message: "Task rated successfully", task });
    } catch (error) {
        console.error("Error rating task:", error);
        res.status(500).json({ message: "Failed to rate task", error: error.message });
    }
}

};

module.exports = driverManagement;
