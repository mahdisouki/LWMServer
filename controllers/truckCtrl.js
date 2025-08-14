const Task = require('../models/Task');
const Truck = require('../models/Truck');
const APIfeatures = require('../utils/APIFeatures');
const loggingService = require('../services/loggingService');
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
      const { name, loadCapacity, matricule, fuelNumber } = req.body;
      const newTruck = new Truck({ name, loadCapacity, matricule, fuelNumber });
      await newTruck.save();

      // Create a log of the creation
      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'CREATE',
        entityType: 'TRUCK',
        entityId: newTruck._id,
        changes: {
          created: newTruck.toObject(),
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

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
    const { dateOfTasks } = req.query
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
            populate: {
              path: 'items.standardItemId',
              select: 'itemName',
            },
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
  updateTruck: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, loadCapacity, matricule, fuelNumber } = req.body;

      // Get the old truck data before updating
      const oldTruck = await Truck.findById(id);
      if (!oldTruck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      // Update the truck
      const updatedTruck = await Truck.findByIdAndUpdate(
        id,
        { name, loadCapacity, matricule, fuelNumber },
        { new: true }
      );

      // Create a log of the changes
      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'UPDATE',
        entityType: 'TRUCK',
        entityId: id,
        changes: {
          before: oldTruck.toObject(),
          after: updatedTruck.toObject(),
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(200).json({ message: 'Truck updated successfully', truck: updatedTruck });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update truck',
        error: error.message
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
      // Get the truck data before deleting
      const truck = await Truck.findById(id);
      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      // Create a log of the deletion before actually deleting
      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'DELETE',
        entityType: 'TRUCK',
        entityId: id,
        changes: {
          deleted: truck.toObject(),
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      // Now delete the truck
      await Truck.findByIdAndDelete(id);
      res.status(200).json({ message: 'Truck deleted successfully' });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to delete truck', error: error.message });
    }
  },
};

module.exports = truckCtrl;
