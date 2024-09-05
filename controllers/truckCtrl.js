const Task = require("../models/Task");
const Truck = require("../models/Truck");


const truckCtrl = {
createTruck: async (req, res) => {
    try {
        const { name ,loadCapacity ,matricule} = req.body;
        const newTruck = new Truck({ name ,loadCapacity,matricule});
        await newTruck.save();
        res.status(201).json({ message: "Truck created successfully", truck: newTruck });
    } catch (error) {
        res.status(500).json({ message: "Failed to create truck", error: error.message });
    }
},
getAllTrucks: async (req, res) => {
    try {
        const trucks = await Truck.find();
        res.status(200).json({ trucks });
    } catch (error) {
        res.status(500).json({ message: "Failed to retrieve trucks", error: error.message });
    }
},
deleteTruck: async (req, res) => {
    const { id } = req.params;
    try {
        const truck = await Truck.findByIdAndDelete(id);
        if (!truck) {
            return res.status(404).json({ message: "Truck not found" });
        }
        res.status(200).json({ message: "Truck deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Failed to delete truck", error: error.message });
    }
},

};

module.exports = truckCtrl;
