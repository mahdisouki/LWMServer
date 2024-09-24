const { User } = require("../models/User");
const Task = require("../models/Task");
const Truck = require("../models/Truck");
const bcrypt = require("bcrypt");
const TruckStatus = require("../models/TruckStatus");

const driverManagement = {
     getTasksForDriver : async (req, res) => {
        const { driverId } = req.params;  // ID of the driver from URL
      
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
      


      // Début de la journée pour un camion
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
    // Fin de la journée pour un camion
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

rateTask: async (req, res) => {
  const { taskId } = req.params;
  const { clientSatisfaction, feedback } = req.body;

  try {
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    task.clientSatisfaction = clientSatisfaction;
    if (feedback) task.feedback = feedback; // Only update feedback if provided

    await task.save();
    res.status(200).json({ message: "Task rated successfully", task });
  } catch (error) {
    res.status(500).json({ message: "Failed to rate task", error: error.message });
  }
}
};






module.exports = driverManagement;
