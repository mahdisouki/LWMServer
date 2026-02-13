const Task = require('../models/Task');
const Truck = require('../models/Truck');
const TippingRequest = require('../models/TippingRequest');
const APIfeatures = require('../utils/APIFeatures');
const loggingService = require('../services/loggingService');
const formatDate = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0'); // Months are zero-based
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper function to format tipping request as task
function formatTippingRequestAsTask(tippingRequest) {
  return {
    _id: `tipping_${tippingRequest._id}`,
    type: 'tipping_request',
    orderNumber: `TIP-${tippingRequest._id.toString().slice(-6)}`,
    firstName: 'Tipping Request',
    lastName: '',
    phoneNumber: '',
    email: '',
    totalPrice: tippingRequest.price || 0,
    taskStatus: tippingRequest.status === 'Accepted' ? 'Completed' : 
                tippingRequest.status === 'Denied' ? 'Declined' : 'Processing',
    paymentStatus: tippingRequest.status === 'Accepted' ? 'Paid' : 'Not_Paid',
    paymentMethod: 'cash',
    date: new Date(tippingRequest.createdAt).toISOString().split('T')[0],
    available: 'AnyTime',
    location: {
      type: 'Point',
      coordinates: [0, 0],
      address: 'Tipping Request'
    },
    items: [{
      object: 'Tipping Request',
      Objectsposition: 'Outside',
      quantity: 1,
      price: tippingRequest.price || 0
    }],
    clientObjectPhotos: tippingRequest.tippingProof || [],
    initialConditionPhotos: [],
    intermediateConditionPhotos: [],
    finalConditionPhotos: [],
    additionalItems: [],
    additionalNotes: tippingRequest.notes || '',
    privateNotes: '',
    createdAt: tippingRequest.createdAt,
    updatedAt: tippingRequest.updatedAt,
    // Tipping request specific fields
    tippingRequestId: tippingRequest._id,
    tippingPlace: tippingRequest.tippingPlace,
    storagePlace: tippingRequest.storagePlace,
    isShipped: tippingRequest.isShipped,
    createdByType: 'driver'
  };
}
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
    const { dateOfTasks } = req.query;

    try {
        const { page = 1, limit = 9, filters, keyword } = req.query; // Add keyword here

        let query = Truck.find();

        // Add keyword search logic
        if (keyword) {
            query = query.find({
                $or: [
                    { name: { $regex: keyword, $options: 'i' } },
                    { matricule: { $regex: keyword, $options: 'i' } },
                    { fuelNumber: { $regex: keyword, $options: 'i' } },
                ],
            });
        }
      
    
        const features = new APIfeatures(query, req.query);
        if (!dateOfTasks) {
          features.paginating();
        }
        if (filters) {
            features.filtering();
        }

        features.sorting();

        const trucks = await features.query
            .populate('driverId')
            .populate('helperId')
            .populate('extraDrivers.driverId')
            .populate('extraHelpers.helperId')
            .exec();

        // ... rest of your existing code for populating tasks ...
        
        const total = await Truck.countDocuments(
            keyword ? {
                $or: [
                    { name: { $regex: keyword, $options: 'i' } },
                    { matricule: { $regex: keyword, $options: 'i' } },
                    { fuelNumber: { $regex: keyword, $options: 'i' } },
                ],
            } : {}
        );

        const currentPage = parseInt(req.query.page, 10) || 1;
        const limitNum = parseInt(req.query.limit, 20) || 20;
        
        res.status(200).json({
            message: 'All trucks retrieved successfully',
            trucks: trucks,
            meta: {
                currentPage,
                limit: limitNum,
                total,
                count: trucks.length,
            },
        });
    } catch (error) {
      console.log(error);
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
        .populate('driverId', 'username picture')
        .populate('helperId', 'username picture')
        .populate('extraDrivers.driverId', 'username picture')
        .populate('extraHelpers.helperId', 'username picture');

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
  getTruckMatricules: async (req, res) => {
    try {
      const matricules = (await Truck.distinct('matricule')).sort();

      res.status(200).json({
        message: 'All truck matricules retrieved successfully',
        matricules,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve truck matricules',
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
