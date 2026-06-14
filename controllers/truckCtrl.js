const Task = require('../models/Task');
const Truck = require('../models/Truck');
const Van = require('../models/Van');
const TippingRequest = require('../models/TippingRequest');
const APIfeatures = require('../utils/APIFeatures');
const loggingService = require('../services/loggingService');
const { logUnitAssignment, getAssignmentsForUnitOnDay, getAssignmentAtTime, getAssignedForDayFromRanges } = require('../services/unitAssignmentLogService');
const UnitAssignmentLogRange = require('../models/UnitAssignmentLogRange');
const { User } = require('../models/User');
const { findTruckByTruckName } = require('../utils/truckHelpers');
const {
  buildChatTrucksPayload,
} = require('../utils/chatMessageHelpers');
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
     
      const newTruck = new Truck({
        name,
        vanId,
        driverId: driverId || undefined,
        helperId: helperId || undefined,
        extraDrivers: extraDrivers || [],
        extraHelpers: extraHelpers || [],
      });
      await newTruck.save();

     

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
        if (oldDriver && !newDriver) {
          await logUnitAssignment({
            truckId: id,
            type: 'driver',
            refId: toId(oldTruck.driverId),
            event: 'deassigned',
            by: userId,
            endAt: now,
          });
        }
        if (newDriver && newDriver !== oldDriver) {
          // Prevent assigning the same driver to two trucks at the same time
          const driverConflict = await UnitAssignmentLogRange.findOne({
            type: 'driver',
            refId: toId(updatedTruck.driverId),
            startAt: { $lte: now },
            $or: [{ endAt: null }, { endAt: { $gte: now } }],
            truckId: { $ne: id },
          }).populate('truckId', 'name');
          if (driverConflict) {
            return res.status(400).json({
              message: 'This driver is already assigned to another truck for this time period.',
              conflictTruck: driverConflict.truckId,
            });
          }
          await logUnitAssignment({
            truckId: id,
            type: 'driver',
            refId: toId(updatedTruck.driverId),
            event: 'assigned',
            by: userId,
            startAt: now,
          });
        }
      }
      if (updateFields.hasOwnProperty('helperId')) {
        if (oldHelper && !newHelper) {
          await logUnitAssignment({
            truckId: id,
            type: 'helper',
            refId: toId(oldTruck.helperId),
            event: 'deassigned',
            by: userId,
            endAt: now,
          });
        }
        if (newHelper && newHelper !== oldHelper) {
          // Prevent assigning the same helper to two trucks at the same time
          const helperConflict = await UnitAssignmentLogRange.findOne({
            type: 'helper',
            refId: toId(updatedTruck.helperId),
            startAt: { $lte: now },
            $or: [{ endAt: null }, { endAt: { $gte: now } }],
            truckId: { $ne: id },
          }).populate('truckId', 'name');
          if (helperConflict) {
            return res.status(400).json({
              message: 'This helper is already assigned to another truck for this time period.',
              conflictTruck: helperConflict.truckId,
            });
          }
          await logUnitAssignment({
            truckId: id,
            type: 'helper',
            refId: toId(updatedTruck.helperId),
            event: 'assigned',
            by: userId,
            startAt: now,
          });
        }
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
      const userId = req.user._id || req.user.id;
      const trucks = await Truck.find()
        .populate('vanId')
        .populate('driverId', 'username picture')
        .populate('helperId', 'username picture')
        .populate('extraDrivers.driverId', 'username picture')
        .populate('extraHelpers.helperId', 'username picture');

      const { trucks: trucksWithMeta, stats } = await buildChatTrucksPayload(trucks, userId);

      res.status(200).json({
        message: 'All trucks retrieved successfully',
        trucks: trucksWithMeta,
        stats,
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
      // Prevent assigning the same van to two trucks at the same time/day
      const vanConflict = await UnitAssignmentLogRange.findOne({
        type: 'van',
        refId: vanId,
        startAt: { $lte: startAtDate },
        $or: [{ endAt: null }, { endAt: { $gte: startAtDate } }],
        truckId: { $ne: truck._id },
      }).populate('truckId', 'name');
      if (vanConflict) {
        return res.status(400).json({
          message: 'This van is already assigned to another truck for this time period.',
          conflictTruck: vanConflict.truckId,
        });
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

  // NEW: Who is assigned to this truck on a given day (van, driver, helper) from UnitAssignmentLogRange
  getAssignedOnDayFromRanges: async (req, res) => {
    try {
      const { id } = req.params;
      const { date } = req.query;

      if (!date) {
        return res.status(400).json({ message: 'Query parameter \"date\" is required (YYYY-MM-DD)' });
      }

      const truck = await Truck.findById(id);
      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      const assigned = await getAssignedForDayFromRanges(id, date);

      // Optionally populate basic info for van/driver/helper
      const staffGeoSelect =
        'firstName lastName username role roleType start_location end_location';
      const [van, driver, helper] = await Promise.all([
        assigned.vanId ? Van.findById(assigned.vanId).select('matricule name currentCapacity') : null,
        assigned.driverId ? User.findById(assigned.driverId).select(staffGeoSelect) : null,
        assigned.helperId ? User.findById(assigned.helperId).select(staffGeoSelect) : null,
      ]);

      return res.status(200).json({
        message: 'Assignments from ranges retrieved successfully',
        truckId: id,
        date,
        assigned: {
          vanId: assigned.vanId,
          driverId: assigned.driverId,
          helperId: assigned.helperId,
          van,
          driver,
          helper,
        },
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to get assigned resources from ranges', error: error.message });
    }
  },

  getAllAssignmentRanges: async (req, res) => {
    try {
      const { truckId, type, refId, from, to, activeOnly } = req.query;
      const query = {};
      if (truckId) query.truckId = truckId;
      if (type) query.type = type;
      if (refId) query.refId = refId;
      if (activeOnly === 'true' || activeOnly === '1') query.endAt = null;
      const fromDate = from ? new Date(from) : null;
      const toDate = to ? new Date(to) : null;
      if (from && Number.isNaN(fromDate.getTime())) {
        return res.status(400).json({ message: 'Invalid "from" date. Use an ISO date-time string.' });
      }
      if (to && Number.isNaN(toDate.getTime())) {
        return res.status(400).json({ message: 'Invalid "to" date. Use an ISO date-time string.' });
      }
      if (fromDate && toDate && fromDate > toDate) {
        return res.status(400).json({ message: '"from" must be less than or equal to "to".' });
      }
      if (fromDate && toDate) {
        // Overlap in [from, to]: startAt <= to AND (endAt is null OR endAt >= from)
        query.$and = [
          { startAt: { $lte: toDate } },
          { $or: [{ endAt: null }, { endAt: { $gte: fromDate } }] },
        ];
      } else if (fromDate) {
        query.$or = [{ endAt: null }, { endAt: { $gte: fromDate } }];
      } else if (toDate) {
        query.startAt = { $lte: toDate };
      }
      const ranges = await UnitAssignmentLogRange.find(query)
        .sort({ startAt: -1 })
        .populate('truckId', 'name')
        .populate('by', 'username')
        .lean();
      // Populate refId from type: van → Van, driver/helper → User
      const { User } = require('../models/User');
      const vanIds = [...new Set(ranges.filter(r => r.type === 'van').map(r => r.refId?.toString()).filter(Boolean))];
      const userIds = [...new Set(ranges.filter(r => r.type === 'driver' || r.type === 'helper').map(r => r.refId?.toString()).filter(Boolean))];
      const [vans, users] = await Promise.all([
        vanIds.length ? Van.find({ _id: { $in: vanIds } }).select('name matricule').lean() : [],
        userIds.length ? User.find({ _id: { $in: userIds } }).select('username firstName lastName').lean() : [],
      ]);
      const vanMap = Object.fromEntries((vans || []).map(v => [v._id.toString(), v]));
      const userMap = Object.fromEntries((users || []).map(u => [u._id.toString(), u]));
      ranges.forEach(r => {
        const id = r.refId?.toString();
        if (r.type === 'van' && id) r.refId = vanMap[id] ?? r.refId;
        else if ((r.type === 'driver' || r.type === 'helper') && id) r.refId = userMap[id] ?? r.refId;
      });
      res.status(200).json({ ranges, count: ranges.length });
    } catch (error) {
      res.status(500).json({ message: 'Failed to get assignment ranges', error: error.message });
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
