const Task = require('../models/Task');
const Truck = require('../models/Truck');
const APIfeatures = require('../utils/APIFeatures');
const formatDate = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0'); // Months are zero-based
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const truckCtrl = {
  createTruck: async (req, res) => {
    try {
      const { name, loadCapacity, matricule } = req.body;
      const newTruck = new Truck({ name, loadCapacity, matricule });
      await newTruck.save();
      res
        .status(201)
        .json({ message: 'Truck created successfully', truck: newTruck });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to create truck', error: error.message });
    }
  },
  getAllTrucks: async (req, res) => {
    const {dateOfTasks} = req.query
    try {
      const { page = 1, limit = 9, filters } = req.query;
      let query = Truck.find();
      const features = new APIfeatures(query, req.query);
      if (filters) {
        features.filtering();
      }
      features.sorting().paginating();
      const trucks = await features.query
        .populate('driverId')
        .populate('helperId')
        .populate({
          path: 'tasks',
          populate: {
            path: dateOfTasks ? dateOfTasks : formatDate(new Date()),
            model: 'Task', 
          },
        })
        .exec();
      const total = await Truck.countDocuments(features.query.getFilter());
      const currentPage = parseInt(req.query.page, 10) || 1;
      const limitNum = parseInt(req.query.limit, 10) || 9;

      res.status(200).json({
        message: 'All trucks retrieved successfully',
        trucks,
        meta: {
          currentPage,
          limit: limitNum,
          total,
          count: trucks.length,
        },
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve trucks',
        error: error.message,
      });
    }
  },

  getAllTrucksForChat: async (req, res) => {
    try {
      const trucks = await Truck.find()
        .populate('driverId')
        .populate('helperId');

      res.status(200).json({
        message: 'All trucks retrieved successfully',
        trucks,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve trucks',
        error: error.message,
      });
    }
  },
  deleteTruck: async (req, res) => {
    const { id } = req.params;
    try {
      const truck = await Truck.findByIdAndDelete(id);
      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }
      res.status(200).json({ message: 'Truck deleted successfully' });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to delete truck', error: error.message });
    }
  },
};

module.exports = truckCtrl;
