const Task = require("../models/Task");
const Truck = require("../models/Truck");




const taskCtrl = {
  createTask: async (req, res) => {
    try {
        const {
            firstName, lastName, phoneNumber,
            location, date, hour, object, price, paymentStatus
        } = req.body;

        const clientObjectPhotos = req.files.map(file => file.path);

        const newTask = new Task({
            firstName,
            lastName,
            phoneNumber,
            location,
            clientObjectPhotos, 
            date,
            hour,
            object,
            price,
            paymentStatus, 
            taskStatus: "Processing"
        });

        await newTask.save();
        res.status(201).json({ message: "Task created successfully", task: newTask });
    } catch (error) {
        res.status(400).json({ message: "Failed to create task", error: error.message });
    }
},

assignTruckToTask: async (req, res) => {
    const { taskId } = req.params; 
    const { truckName } = req.body; 

    try {
        
        const truck = await Truck.findOne({ name: truckName });
        if (!truck) {
            return res.status(404).json({ message: "Truck not found" });
        }

     
        const updatedTask = await Task.findByIdAndUpdate(
            taskId,
            { $set: { truckId: truck._id } }, 
            { new: true }
        );

        if (!updatedTask) {
            return res.status(404).json({ message: "Task not found" });
        }

      
        truck.tasks.push(updatedTask._id);
        await truck.save(); 

        res.status(200).json({ message: "Truck assigned to task successfully", task: updatedTask });
    } catch (error) {
        res.status(500).json({ message: "Failed to assign truck", error: error.message });
    }
},



};

module.exports = taskCtrl;
