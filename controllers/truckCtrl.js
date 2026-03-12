const Task = require('../models/Task');
const Truck = require('../models/Truck');
const Van = require('../models/Van');
const TippingRequest = require('../models/TippingRequest');
const APIfeatures = require('../utils/APIFeatures');
const loggingService = require('../services/loggingService');
const { logUnitAssignment, getAssignmentsForUnitOnDay, getAssignmentAtTime } = require('../services/unitAssignmentLogService');
const { findTruckByTruckName } = require('../utils/truckHelpers');
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
      const { name, vanId, driverId, helperId, extraDrivers, extraHelpers } = req.body;
      if (!vanId) {
        return res.status(400).json({ message: 'vanId is required' });
      }
      const van = await Van.findById(vanId);
      if (!van) {
        return res.status(404).json({ message: 'Van not found' });
      }
      const newTruck = new Truck({
        name: name || van.matricule || van.name,
        vanId,
        driverId: driverId || undefined,
        helperId: helperId || undefined,
        extraDrivers: extraDrivers || [],
        extraHelpers: extraHelpers || [],
      });
      await newTruck.save();

      if (newTruck.vanId) {
        await logUnitAssignment({
          truckId: newTruck._id,
          type: 'van',
          refId: newTruck.vanId,
          event: 'assigned',
          by: req.user && req.user._id,
          startAt: new Date(),
        });
      }

      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'CREATE',
        entityType: 'TRUCK',
        entityId: newTruck._id,
        changes: { created: newTruck.toObject() },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      const truck = await Truck.findById(newTruck._id)
        .populate('vanId')
        .populate('driverId')
        .populate('helperId')
        .populate('extraDrivers.driverId')
        .populate('extraHelpers.helperId');
      res.status(201).json({ message: 'Truck created successfully', truck });
    } catch (error) {
      res.status(500).json({ message: 'Failed to create truck', error: error.message });
    }
  },
  getAllTrucks: async (req, res) => {
    const { dateOfTasks } = req.query;
    try {
      const { page = 1, limit = 9, filters, keyword } = req.query;
      let query = Truck.find();

      if (keyword) {
        const vanIds = (await Van.find({
          $or: [
            { name: { $regex: keyword, $options: 'i' } },
            { matricule: { $regex: keyword, $options: 'i' } },
            { fuelNumber: { $regex: keyword, $options: 'i' } },
          ],
        }).select('_id')).map((v) => v._id);
        query = query.find({
          $or: [
            { name: { $regex: keyword, $options: 'i' } },
            { vanId: { $in: vanIds } },
          ],
        });
      }

      const features = new APIfeatures(query, req.query);
      if (!dateOfTasks) features.paginating();
      if (filters) features.filtering();
      features.sorting();

      const trucks = await features.query
        .populate('vanId')
        .populate('driverId')
        .populate('helperId')
        .populate('extraDrivers.driverId')
        .populate('extraHelpers.helperId')
        .exec();

      let total;
      if (keyword) {
        const vanIds = (await Van.find({
          $or: [
            { name: { $regex: keyword, $options: 'i' } },
            { matricule: { $regex: keyword, $options: 'i' } },
            { fuelNumber: { $regex: keyword, $options: 'i' } },
          ],
        }).select('_id')).map((v) => v._id);
        total = await Truck.countDocuments({
          $or: [
            { name: { $regex: keyword, $options: 'i' } },
            { vanId: { $in: vanIds } },
          ],
        });
      } else {
        total = await Truck.countDocuments();
      }

      const currentPage = parseInt(req.query.page, 10) || 1;
      const limitNum = parseInt(req.query.limit, 20) || 20;
      res.status(200).json({
        message: 'All trucks retrieved successfully',
        trucks,
        meta: { currentPage, limit: limitNum, total, count: trucks.length },
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: 'Failed to retrieve trucks', error: error.message });
    }
  },
  updateTruck: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, vanId, driverId, helperId, extraDrivers, extraHelpers } = req.body;

      const oldTruck = await Truck.findById(id);
      if (!oldTruck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      const updateFields = {};
      if (name !== undefined) updateFields.name = name;
      if (vanId !== undefined) updateFields.vanId = vanId;
      if (driverId !== undefined) updateFields.driverId = driverId;
      if (helperId !== undefined) updateFields.helperId = helperId;
      if (extraDrivers !== undefined) updateFields.extraDrivers = extraDrivers;
      if (extraHelpers !== undefined) updateFields.extraHelpers = extraHelpers;

      const updatedTruck = await Truck.findByIdAndUpdate(id, updateFields, { new: true })
        .populate('vanId')
        .populate('driverId')
        .populate('helperId')
        .populate('extraDrivers.driverId')
        .populate('extraHelpers.helperId');

      const userId = req.user && req.user._id ? req.user._id.toString() : null;
      const oldVan = oldTruck.vanId && oldTruck.vanId.toString();
      const oldDriver = oldTruck.driverId && oldTruck.driverId.toString();
      const oldHelper = oldTruck.helperId && oldTruck.helperId.toString();
      const newVan = updatedTruck.vanId && updatedTruck.vanId._id ? updatedTruck.vanId._id.toString() : (updatedTruck.vanId && updatedTruck.vanId.toString()) || null;
      const newDriver = updatedTruck.driverId && updatedTruck.driverId._id ? updatedTruck.driverId._id.toString() : (updatedTruck.driverId && updatedTruck.driverId.toString()) || null;
      const newHelper = updatedTruck.helperId && updatedTruck.helperId._id ? updatedTruck.helperId._id.toString() : (updatedTruck.helperId && updatedTruck.helperId.toString()) || null;

      const toId = (v) => (v && (v._id || v));
      const now = new Date();
      if (updateFields.hasOwnProperty('vanId')) {
        if (oldVan && !newVan) await logUnitAssignment({ truckId: id, type: 'van', refId: toId(oldTruck.vanId), event: 'deassigned', by: userId, endAt: now });
        if (newVan && newVan !== oldVan) await logUnitAssignment({ truckId: id, type: 'van', refId: toId(updatedTruck.vanId), event: 'assigned', by: userId, startAt: now });
      }
      if (updateFields.hasOwnProperty('driverId')) {
        if (oldDriver && !newDriver) await logUnitAssignment({ truckId: id, type: 'driver', refId: toId(oldTruck.driverId), event: 'deassigned', by: userId, endAt: now });
        if (newDriver && newDriver !== oldDriver) await logUnitAssignment({ truckId: id, type: 'driver', refId: toId(updatedTruck.driverId), event: 'assigned', by: userId, startAt: now });
      }
      if (updateFields.hasOwnProperty('helperId')) {
        if (oldHelper && !newHelper) await logUnitAssignment({ truckId: id, type: 'helper', refId: toId(oldTruck.helperId), event: 'deassigned', by: userId, endAt: now });
        if (newHelper && newHelper !== oldHelper) await logUnitAssignment({ truckId: id, type: 'helper', refId: toId(updatedTruck.helperId), event: 'assigned', by: userId, startAt: now });
      }

      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'UPDATE',
        entityType: 'TRUCK',
        entityId: id,
        changes: { before: oldTruck.toObject(), after: updatedTruck.toObject() },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(200).json({ message: 'Truck updated successfully', truck: updatedTruck });
    } catch (error) {
      res.status(500).json({ message: 'Failed to update truck', error: error.message });
    }
  },
  getAllTrucksForChat: async (req, res) => {
    try {
      const trucks = await Truck.find()
        .populate('vanId')
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
      const matricules = (await Van.distinct('matricule')).sort();

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

  assignVanToTruck: async (req, res) => {
    try {
      const { truckName, vanId, startAt } = req.body;
      if (!truckName || !vanId) {
        return res.status(400).json({ message: 'truckName and vanId are required' });
      }
      const truck = await findTruckByTruckName(truckName);
      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }
      const van = await Van.findById(vanId);
      if (!van) {
        return res.status(404).json({ message: 'Van not found' });
      }
      if (truck.vanId && truck.vanId.toString() === vanId) {
        return res.status(400).json({ message: 'This van is already assigned to the truck' });
      }
      const startAtDate = startAt ? new Date(startAt) : new Date();
      if (isNaN(startAtDate.getTime())) {
        return res.status(400).json({ message: 'Invalid startAt date/time' });
      }
      truck.vanId = vanId;
      await truck.save();
      await logUnitAssignment({
        truckId: truck._id,
        type: 'van',
        refId: vanId,
        event: 'assigned',
        by: req.user && req.user._id,
        startAt: startAtDate,
      });
      const populated = await Truck.findById(truck._id).populate('vanId').populate('driverId').populate('helperId');
      res.status(200).json({ message: 'Van assigned to truck successfully', truck: populated });
    } catch (error) {
      res.status(500).json({ message: 'Failed to assign van to truck', error: error.message });
    }
  },

  deassignVanFromTruck: async (req, res) => {
    try {
      const { truckName, endAt } = req.body;
      if (!truckName) {
        return res.status(400).json({ message: 'truckName is required' });
      }
      const truck = await findTruckByTruckName(truckName);
      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }
      if (!truck.vanId) {
        return res.status(400).json({ message: 'No van assigned to this truck' });
      }
      const endAtDate = endAt ? new Date(endAt) : new Date();
      if (isNaN(endAtDate.getTime())) {
        return res.status(400).json({ message: 'Invalid endAt date/time' });
      }
      const previousVanId = truck.vanId;
      truck.vanId = undefined;
      await truck.save();
      await logUnitAssignment({
        truckId: truck._id,
        type: 'van',
        refId: previousVanId,
        event: 'deassigned',
        by: req.user && req.user._id,
        endAt: endAtDate,
      });
      const populated = await Truck.findById(truck._id).populate('vanId').populate('driverId').populate('helperId');
      res.status(200).json({ message: 'Van deassigned from truck successfully', truck: populated });
    } catch (error) {
      res.status(500).json({ message: 'Failed to deassign van from truck', error: error.message });
    }
  },

  getAssignmentsOnDay: async (req, res) => {
    try {
      const { id } = req.params;
      const { date } = req.query;
      if (!date) {
        return res.status(400).json({ message: 'Query parameter "date" is required (YYYY-MM-DD)' });
      }
      const truck = await Truck.findById(id);
      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }
      const data = await getAssignmentsForUnitOnDay(id, date);
      return res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to get assignments on day', error: error.message });
    }
  },

  getAssignmentAtTime: async (req, res) => {
    try {
      const { id } = req.params;
      const { at } = req.query;
      if (!at) {
        return res.status(400).json({ message: 'Query parameter "at" is required (ISO date-time)' });
      }
      const truck = await Truck.findById(id);
      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }
      const data = await getAssignmentAtTime(id, at);
      return res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to get assignment at time', error: error.message });
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
