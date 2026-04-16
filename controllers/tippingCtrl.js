const TippingRequest = require('../models/TippingRequest');
const { User } = require('../models/User');
const Truck = require('../models/Truck');
const Van = require('../models/Van');
const { getAssignedForDayFromRanges } = require('../services/unitAssignmentLogService');
const { truckDisplayName } = require('../utils/truckHelpers');
const APIfeatures = require('../utils/APIFeatures');
const { emitEvent, emitNotificationToUser } = require('../socket');
const Driver = require('../models/Driver');
const TippingPlace = require('../models/TippingPlaces');
const paginateQuery = require('../utils/paginationHelper');
const loggingService = require('../services/loggingService');
const dailySheetController = require('./dailySheetController');
const adminId = "67cb6810c9e768ec25d39523";

const toBooleanOrUndefined = (value) => {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
};

/**
 * Subtract removed items from the van tied to truckId on the given day (assignment ranges + truck.vanId fallback).
 * Throws on invalid payload or inconsistent van state.
 */
async function subtractRemovedItemsFromVanForTruck({ truckId, dateAnchor, removedItems }) {
  if (!truckId) {
    throw new Error('truckId is required to update van load');
  }
  if (!dateAnchor) {
    throw new Error('tipdate or createdAt is required to resolve van assignment');
  }
  if (!Array.isArray(removedItems) || removedItems.length === 0) {
    throw new Error('removedItems must be a non-empty array when marking tipping as shipped');
  }

  const dateStr = new Date(dateAnchor).toISOString().split('T')[0];
  const assigned = await getAssignedForDayFromRanges(truckId, dateStr);
  const truckRow = await Truck.findById(truckId).select('vanId').lean();
  const vanId = assigned.vanId || truckRow?.vanId;
  if (!vanId) {
    throw new Error('No van assigned for this truck on the tipping date');
  }

  const van = await Van.findById(vanId);
  if (!van) {
    throw new Error('Van not found');
  }

  van.itemsInTruck = Array.isArray(van.itemsInTruck) ? van.itemsInTruck : [];

  let totalRemovedSpace = 0;

  for (const r of removedItems) {
    const itemName = String(r?.item ?? '').trim();
    const qtyToRemove = Number(r?.quantity);
    const spaceToRemove = Number(r?.spaceOfVan);

    if (!itemName || !Number.isFinite(qtyToRemove) || qtyToRemove <= 0) {
      throw new Error(`Invalid quantity for item "${itemName || '(unknown)'}"`);
    }
    if (!Number.isFinite(spaceToRemove) || spaceToRemove <= 0) {
      throw new Error(`Invalid spaceOfVan for item "${itemName}"`);
    }

    const idx = van.itemsInTruck.findIndex((x) => String(x.item).trim() === itemName);
    if (idx < 0) {
      throw new Error(`Item "${itemName}" not found on van`);
    }

    const currentQty = Number(van.itemsInTruck[idx].quantity || 0);
    const currentSpace = Number(van.itemsInTruck[idx].spaceOfVan || 0);

    if (qtyToRemove > currentQty || spaceToRemove > currentSpace) {
      throw new Error(`Cannot remove more than on-van quantity/space for "${itemName}"`);
    }

    van.itemsInTruck[idx].quantity = currentQty - qtyToRemove;
    van.itemsInTruck[idx].spaceOfVan = currentSpace - spaceToRemove;
    totalRemovedSpace += spaceToRemove;
  }

  van.itemsInTruck = van.itemsInTruck.filter(
    (x) => Number(x.quantity || 0) > 0 && Number(x.spaceOfVan || 0) > 0,
  );

  van.currentCapacity = Math.max(0, Number(van.currentCapacity || 0) - totalRemovedSpace);
  await van.save();
}

// Helper function to update daily sheets when tipping request changes
const updateDailySheetForTippingRequest = async (tippingRequest) => {
  try {
    if (!tippingRequest || !tippingRequest.userId) {
      return;
    }

    // Determine the date to use - prefer tipdate, fallback to createdAt
    const requestDate = tippingRequest.tipdate || tippingRequest.createdAt;
    if (!requestDate) {
      console.log('No date found for tipping request, skipping daily sheet update');
      return;
    }

    // Pass the actual date object to avoid timezone shifting
    // Create mock request/response objects for updateExistingDailySheets
    const mockReq = {
      body: { date: requestDate }
    };
    const mockRes = {
      status: () => ({ json: () => { } }),
      json: () => { }
    };

    // First ensure the tipping request is in the truck's tasks array for that date
    if (tippingRequest.truckId && tippingRequest._id) {
      const truck = await Truck.findById(tippingRequest.truckId);
      if (truck) {
        const dObj = new Date(requestDate);
        const y = dObj.getFullYear();
        const m = String(dObj.getMonth() + 1).padStart(2, '0');
        const d = String(dObj.getDate()).padStart(2, '0');
        const formattedDate = `${y}-${m}-${d}`;
        
        let tasksForDate = [];
        if (truck.tasks instanceof Map) {
          tasksForDate = truck.tasks.get(formattedDate) || [];
        } else if (typeof truck.tasks === 'object' && truck.tasks) {
          tasksForDate = truck.tasks[formattedDate] || [];
        }

        // Check if it's already there
        const exists = tasksForDate.some(t => {
          const tid = typeof t === 'string' ? t : (t.taskId ? t.taskId.toString() : null);
          return tid === tippingRequest._id.toString();
        });

        if (!exists) {
          console.log(`Adding tipping request ${tippingRequest._id} to truck ${truckDisplayName(truck)} for date ${formattedDate}`);
          truck.addTippingRequest(formattedDate, tippingRequest._id);
          await truck.save();
        }
      }
    }

    await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
    console.log('Daily sheet updated for tipping request on date:', requestDate);
  } catch (error) {
    console.error('Error updating daily sheet for tipping request:', error);
    // Don't throw - we don't want to fail the main operation
  }
};

const tippingController = {
  createTippingRequest: async (req, res) => {
    const userId = req.user._id;
    const { notes, tipdate, emptyTipping } = req.body;

    try {
      const user = await User.findById(userId);
      if (!user || (user.roleType !== 'Driver' && user.roleType !== 'Helper')) {
        return res.status(403).json({
          message:
            'Unauthorized: Only drivers and helpers can make tipping requests.',
        });
      }
      // Find the truck assigned to this user (as driver or helper)
      let truck = await Truck.findOne({ driverId: userId });
      if (!truck) {
        truck = await Truck.findOne({ helperId: userId });
      }

      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      const newTippingRequest = new TippingRequest({
        userId: userId,
        truckId: truck._id, // Set truckId when creating
        notes: notes,
        status: 'Pending',
        tipdate: Date.now(), // Set tipdate to current date when created by non-admin
        emptyTipping: toBooleanOrUndefined(emptyTipping),
      });
      console.log(newTippingRequest);
      await newTippingRequest.save();

      // Update daily sheet after creation
      await updateDailySheetForTippingRequest(newTippingRequest);

      // Create a log of the tipping request creation
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'CREATE',
          entityType: 'TIPPING_REQUEST',
          entityId: newTippingRequest._id,
          changes: {
            created: newTippingRequest.toObject(),
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      // Send notification to all admins
      try {
        const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
        const userName = user.username || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Driver/Helper';
        const notificationMessage = `${userName} has created a new tipping request for ${truckDisplayName(truck)}`;

        // Send notification to all admins
        for (const admin of adminUsers) {
          if (admin._id) {
            await emitNotificationToUser(
              admin._id.toString(),
              'Tipping',
              notificationMessage,
              userName
            );
          }
        }

        // Also send to the hardcoded adminId as a fallback
        if (adminId) {
          await emitNotificationToUser(
            adminId,
            'Tipping',
            notificationMessage,
            userName
          );
        }
      } catch (notificationError) {
        console.error('Error sending notification to admin:', notificationError);
        // Don't fail the request if notification fails
      }

      const response = {
        message: 'Tipping request created successfully',
        request: {
          id: newTippingRequest._id,
          userId: newTippingRequest.userId.toString(),
          notes: newTippingRequest.notes,
          status: newTippingRequest.status,
          emptyTipping: newTippingRequest.emptyTipping,
          createdAt: newTippingRequest.createdAt,
          userName: user.username,
          truckName: truckDisplayName(truck),
        },
      };

      res.status(201).json(response);
    } catch (error) {
      console.error('Error in creating tipping request:', error);
      res.status(500).json({
        message: 'Failed to create tipping request',
        error: error.message,
      });
    }
  },

  createTippingRequestByAdmin: async (req, res) => {
    const adminId = req.user._id;
    // const { driverId, truckId, tippingPlace, notes, status } = req.body;
    const { driverId, notes, status, tipdate, price, tippingPlace, isShipped, emptyTipping } = req.body;

    // Handle file uploads for tipping proof
    let tippingProof = [];
    if (req.files && req.files.length > 0) {
      tippingProof = req.files.map(file => file.path);
    }

    try {
      // Validate required fields
      if (!driverId) {
        return res.status(400).json({ message: 'Driver ID is required' });
      }

      // Ensure the user making the request is an admin
      const admin = await User.findById(adminId);
      if (!admin || admin.roleType !== 'Admin') {
        return res.status(403).json({
          message: 'Unauthorized: Only admins can create tipping requests.',
        });
      }

      // Find the driver
      const driver = await User.findById(driverId);
      if (!driver) {
        return res.status(404).json({ message: 'Driver not found' });
      }
      if (driver.roleType !== 'Driver') {
        return res.status(400).json({ message: 'User is not a driver' });
      }

      // Find the truck assigned to this driver
      let truck = await Truck.findOne({ driverId: driver._id });
      if (!truck) {
        truck = await Truck.findOne({ helperId: driver._id });
      }

      // Create the tipping request
      const newTippingRequest = new TippingRequest({
        userId: driver._id, // Assigning the tipping request to the driver
        truckId: truck ? truck._id : undefined, // Set truckId if truck exists
        tippingPlace: tippingPlace, // Tipping place
        notes: notes,
        status: status,
        isShipped: isShipped,
        emptyTipping: toBooleanOrUndefined(emptyTipping),
        tipdate: tipdate || Date.now(), // Tip date set by admin, default to current date if not provided
        tippingProof: tippingProof.length > 0 ? tippingProof : undefined, // Tipping proof images from files
        price: price, // Price
        createdBy: admin._id, // Storing the admin who created the request
      });

      await newTippingRequest.save();

      // Update daily sheet after creation
      await updateDailySheetForTippingRequest(newTippingRequest);

      // Create a log of the tipping request creation by admin
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'CREATE',
          entityType: 'TIPPING_REQUEST',
          entityId: newTippingRequest._id,
          changes: {
            created: newTippingRequest.toObject(),
            createdByAdmin: true,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      const response = {
        message: 'Tipping request created successfully by admin',
        request: {
          id: newTippingRequest._id,
          driverId: newTippingRequest.userId.toString(),
          truckId: newTippingRequest.truckId ? newTippingRequest.truckId.toString() : null,
          tippingPlace: newTippingRequest.tippingPlace,
          notes: newTippingRequest.notes,
          status: newTippingRequest.status,
          emptyTipping: newTippingRequest.emptyTipping,
          tipdate: newTippingRequest.tipdate,
          tippingProof: newTippingRequest.tippingProof,
          isShipped: newTippingRequest.isShipped,
          price: newTippingRequest.price,
          createdAt: newTippingRequest.createdAt,
          createdBy: admin.username, // Admin's name
          driverName: driver.username, // Driver's name
          // truckName: truckDisplayName(truck), // Truck's name
        },
      };

      res.status(201).json(response);
    } catch (error) {
      console.error('Error in creating tipping request by admin:', error);
      res.status(500).json({
        message: 'Failed to create tipping request',
        error: error.message,
      });
    }
  },
  getAllTippingRequestsForUser: async (req, res) => {
    const userId = req.user._id;
    try {
      const requests = await TippingRequest.find({ userId });
      res.status(200).json({ requests });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve tipping requests',
        error: error.message,
      });
    }
  },

  getTippingRequestById: async (req, res) => {
    const { id } = req.params;
    try {
      const request = await TippingRequest.findById(id);

      if (!request) {
        return res.status(404).json({ message: 'Tipping request not found' });
      }
      res.status(200).json({ request });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve tipping request',
        error: error.message,
      });
    }
  },

  getTippingRequestByUserId: async (req, res) => {
    const { userId } = req.params;
    try {
      const requests = await TippingRequest.find({
        userId,
        isShipped: false,
      }).sort({ createdAt: -1 });

      res.status(200).json({ requests });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve tipping requests',
        error: error.message,
      });
    }
  },

  deleteTippingRequest: async (req, res) => {
    const { id } = req.params;
    try {
      const request = await TippingRequest.findById(id);
      if (!request) {
        return res.status(404).json({ message: 'Tipping request not found' });
      }

      // Create a log of the deletion before actually deleting
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'DELETE',
          entityType: 'TIPPING_REQUEST',
          entityId: id,
          changes: {
            deleted: request.toObject(),
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      await TippingRequest.findByIdAndDelete(id);
      res.status(200).json({ message: 'Tipping request deleted successfully' });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to delete tipping request',
        error: error.message,
      });
    }
  },

  getAllTippingRequestsForAdmin: async (req, res) => {
    try {
      const { keyword, tippingPlace, storagePlace } = req.query;

      // Build query filters
      const queryFilters = {};
      if (tippingPlace) {
        queryFilters.tippingPlace = tippingPlace;
      }
      if (storagePlace) {
        queryFilters.storagePlace = storagePlace;
      }
      // Pass the model, not .find(), and let paginateQuery apply filters
      const { data, meta } = await paginateQuery(
        TippingRequest,
        req.query, // Merge filters into req.query if paginateQuery supports it
        ['collectionDate', 'paymentStatus', 'tippingPlace', 'storagePlace'],
        []
      );

      // Populate related fields, including _id
      const populatedData = await TippingRequest.populate(data, [
        { path: 'userId', select: 'username roleType' },
        { path: 'tippingPlace', select: 'name address _id location' },
        { path: 'storagePlace', select: 'name address _id location' }
      ]);

      let filteredData = populatedData;

      // Apply keyword search if provided
      if (keyword) {
        const lowerKeyword = keyword.toLowerCase();
        filteredData = filteredData.filter((req) => {
          if (!req) return false;
          const username = req.userId?.username?.toLowerCase() || '';
          const tippingPlaceName = req.tippingPlace?.name?.toLowerCase() || '';
          const storagePlaceName = req.storagePlace?.name?.toLowerCase() || '';
          return (
            username.includes(lowerKeyword) ||
            tippingPlaceName.includes(lowerKeyword) ||
            storagePlaceName.includes(lowerKeyword)
          );
        });
      }

      // Enrich and format response
      const enrichedRequests = filteredData
        .filter(req => !!req)
        .map((req) => {
          const obj = req.toObject();
          obj.username = req.userId?.username ?? 'Unknown User';
          obj.tippingPlace = req.tippingPlace ? {
            _id: req.tippingPlace._id,
            name: req.tippingPlace.name,
            address: req.tippingPlace.address,
            location: req.tippingPlace.location
          } : null;
          obj.storagePlace = req.storagePlace ? {
            _id: req.storagePlace._id,
            name: req.storagePlace.name,
            address: req.storagePlace.address,
            location: req.storagePlace.location
          } : null;
          return obj;
        });

      // Return result
      res.status(200).json({
        message: 'All tipping requests retrieved successfully',
        requests: enrichedRequests,
        meta: {
          ...meta,
          count: enrichedRequests.length,
        },
      });
    } catch (error) {
      console.error('Error stack:', error.stack);
      console.error('Error message:', error.message);
      res.status(500).json({
        message: 'Failed to retrieve all tipping requests',
        error: error.message,
        stack: error.stack,
      });
    }
  },



  // Update the status of a tipping request (Admin only)
  updateTippingRequestStatus: async (req, res) => {
    const { id } = req.params; // ID of the tipping request
    const { status, tippingPlace } = req.body; // New status to be set

    try {
      // Fetch the tipping request
      const oldRequest = await TippingRequest.findById(id);

      if (!oldRequest) {
        return res.status(404).json({ message: 'Tipping request not found' });
      }

      // Find the truck assigned to this driver to get helperId
      let truck = await Truck.findOne({ driverId: oldRequest.userId });
      if (!truck) {
        truck = await Truck.findOne({ helperId: oldRequest.userId });
      }

      const helperId = truck ? truck.helperId : null;

      // Update status
      const request = oldRequest;
      request.status = status;
      request.tippingPlace = tippingPlace;

      // Set truckId if it's not already set and truck exists
      if (!request.truckId && truck) {
        request.truckId = truck._id;
      }


      // Handle storage place logic based on status
      if (status === 'Accepted') {
        // Set storage place to local storage (default storage place)
        const StoragePlace = require('../models/StroragePlace');
        let localPlace = await StoragePlace.findOne({ name: /^local$/i });

        // If no local storage place exists, create one
        if (!localPlace) {
          localPlace = new StoragePlace({
            name: "Local",
            address: "Local Storage",
            location: {
              latitude: 51.5074, // London coordinates as default
              longitude: -0.1278
            },
            capacity: 1000,
            availableCapacity: 1000
          });
          await localPlace.save();
        }

        request.storagePlace = localPlace._id;
      } else if (status === 'Denied') {
        // Clear storage place when denied
        request.storagePlace = undefined;
      }

      await request.save();

      // Update daily sheet after status change
      await updateDailySheetForTippingRequest(request);

      // Create a log of the status change
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          tipdate: request.tipdate,
          action: 'UPDATE',
          entityType: 'TIPPING_REQUEST',
          entityId: id,
          changes: {
            before: { status: oldRequest.status, tippingPlace: oldRequest.tippingPlace },
            after: { status: request.status, tippingPlace: request.tippingPlace },
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      if (status === 'GoToTipping' || status === 'TippingAndStorage') {
        // Fetch the driver's location
        const driver = await Driver.findById(request.userId).select('location');

        if (driver && helperId) {
          const driverLocation = driver.location;
          console.log('Driver Location:', driverLocation);

          // Find the nearest tipping place
          const tippingPlaces = await TippingPlace.find();

          emitEvent('driverOnTheWay', {
            helperId,
          });
        }
      }

      res.status(200).json({
        message: 'Tipping request status updated successfully',
        request,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update tipping request status',
        error: error.message,
      });
    }
  },

  markShipped: async (req, res) => {
    const userId = req.user._id;
    try {
      const request = await TippingRequest.findOne({
        userId,
        isShipped: false,
      }).sort({ createdAt: -1 });

      if (!request) {
        return res.status(404).json({ message: 'Tipping request not found' });
      }

      // Set truckId if it's not already set
      if (!request.truckId) {
        let truck = await Truck.findOne({ driverId: request.userId });
        if (!truck) {
          truck = await Truck.findOne({ helperId: request.userId });
        }
        if (truck) {
          request.truckId = truck._id;
        }
      }

      request.isShipped = true;
      await request.save();

      // Update daily sheet after marking as shipped
      await updateDailySheetForTippingRequest(request);

      res.status(200).json({
        message: 'Tipping request marked as shipped successfully',
        request,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to mark tipping request as shipped',
        error: error.message,
      });
    }
  },

  uploadTippingProof: async (req, res) => {
    const { id } = req.params; // Tipping request ID
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No files uploaded' });
      }

      const request = await TippingRequest.findById(id);
      if (!request) {
        return res.status(404).json({ message: 'Tipping request not found' });
      }

      // Set truckId if it's not already set
      if (!request.truckId) {
        let truck = await Truck.findOne({ driverId: request.userId });
        if (!truck) {
          truck = await Truck.findOne({ helperId: request.userId });
        }
        if (truck) {
          request.truckId = truck._id;
        }
      }

      // Extract Cloudinary URLs from uploaded files
      const proofUrls = req.files.map(file => file.path);

      // Append new proof files to existing ones
      request.tippingProof = [...(request.tippingProof || []), ...proofUrls];
      request.isShipped = true;
      await request.save();

      // Update daily sheet after proof upload
      await updateDailySheetForTippingRequest(request);

      res.status(200).json({
        message: 'Tipping proof uploaded successfully',
        proofUrls,
        request
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to upload tipping proof',
        error: error.message,
      });
    }
  },

  getTippingRequestLocations: async (req, res) => {
    const { tippingRequestId } = req.params; // Get tipping request ID from URL params

    try {
      // Find the tipping request
      const tippingRequest = await TippingRequest.findById(tippingRequestId).populate('userId');
      if (!tippingRequest) {
        return res.status(404).json({ message: 'Tipping request not found' });
      }

      // Retrieve the driver associated with the truck
      const truck = tippingRequest.userId;
      console.log(tippingRequest)
      if (!truck) {
        return res.status(404).json({ message: 'Driver not found for this truck' });
      }



      // Fetch all tipping places with their locations
      const tippingPlaces = await TippingPlace.find();

      // Format the response
      const response = {
        driverLocation: {
          latitude: truck.location.coordinates[1], // Assuming [lng, lat]
          longitude: truck.location.coordinates[0],
        },
        tippingPlaces: tippingPlaces.map(place => ({
          id: place._id,
          name: place.name,
          latitude: place.location.coordinates[1], // Assuming [lng, lat]
          longitude: place.location.coordinates[0],
          operatingHours: place.operatingHours,
          itemsAllowed: place.itemsAllowed,
          itemsNotAllowed: place.itemsNotAllowed,
          daysClosed: place.daysClosed
        })),
      };

      res.status(200).json({
        message: 'Driver and tipping places locations retrieved successfully',
        data: response,
      });
    } catch (error) {
      console.error('Error retrieving tipping request locations:', error);
      res.status(500).json({ message: 'Failed to retrieve locations', error: error.message });
    }
  },
  updateTippingRequest: async (req, res) => {
    const { id } = req.params;  // Tipping request ID
    const {
      price,
      tipdate,
      tippingPlace,
      emptyTipping,
      isShipped,
      removedItems,
      ...otherFields
    } = req.body;

    try {
      // Get the old request before updating
      const oldRequest = await TippingRequest.findById(id);
      if (!oldRequest) {
        return res.status(404).json({ message: 'Tipping request not found' });
      }

      // Build update object with explicit handling of the specified fields
      const updateFields = {
        ...otherFields
      };

      // Set truckId if it's not already set
      if (!oldRequest.truckId && oldRequest.userId) {
        let truck = await Truck.findOne({ driverId: oldRequest.userId });
        if (!truck) {
          truck = await Truck.findOne({ helperId: oldRequest.userId });
        }
        if (truck) {
          updateFields.truckId = truck._id;
        }
      }

      // Handle file uploads for tipping proof
      if (req.files && req.files.length > 0) {
        // Extract Cloudinary URLs from uploaded files
        const proofUrls = req.files.map(file => file.path);
        // Append new proof files to existing ones (like in markShippedWithProof)
        updateFields.tippingProof = [...(oldRequest.tippingProof || []), ...proofUrls];
      }

      // Explicitly add the fields if they are provided
      if (price !== undefined) updateFields.price = price;
      if (tipdate !== undefined) updateFields.tipdate = tipdate;
      if (tippingPlace !== undefined) updateFields.tippingPlace = tippingPlace;
      if (emptyTipping !== undefined) {
        const parsedEmptyTipping = toBooleanOrUndefined(emptyTipping);
        if (parsedEmptyTipping === undefined) {
          return res.status(400).json({
            message: 'emptyTipping must be a boolean',
          });
        }
        updateFields.emptyTipping = parsedEmptyTipping;
      }

      if (isShipped !== undefined) {
        const parsedIsShipped = toBooleanOrUndefined(isShipped);
        if (parsedIsShipped === undefined) {
          return res.status(400).json({
            message: 'isShipped must be a boolean',
          });
        }
        updateFields.isShipped = parsedIsShipped;
      }

      const wasShipped = Boolean(oldRequest.isShipped);
      const nextIsShipped =
        updateFields.isShipped !== undefined ? updateFields.isShipped : oldRequest.isShipped;
      const willShip = nextIsShipped === true && !wasShipped;

      if (willShip) {
        const effectiveTruckId = oldRequest.truckId || updateFields.truckId;
        if (!effectiveTruckId) {
          return res.status(400).json({
            message: 'Cannot mark as shipped: truckId is missing for this tipping request.',
          });
        }
        const dateAnchor =
          updateFields.tipdate !== undefined ? updateFields.tipdate : oldRequest.tipdate || oldRequest.createdAt;
        try {
          await subtractRemovedItemsFromVanForTruck({
            truckId: effectiveTruckId,
            dateAnchor,
            removedItems,
          });
        } catch (err) {
          return res.status(400).json({
            message: err.message || 'Failed to update van load for shipped tipping.',
          });
        }
      }

      // Find and update the tipping request
      const updatedRequest = await TippingRequest.findByIdAndUpdate(
        id,
        updateFields,
        { new: true }  // Return the updated document
      ).populate([
        { path: 'userId', select: 'username roleType' },
        { path: 'tippingPlace', select: 'name address' },
        { path: 'storagePlace', select: 'name address' }
      ]);

      // Update daily sheet after update
      await updateDailySheetForTippingRequest(updatedRequest);

      // Create a log of the changes
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'UPDATE',
          entityType: 'TIPPING_REQUEST',
          entityId: id,
          changes: {
            before: oldRequest.toObject(),
            after: updatedRequest.toObject(),
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      res.status(200).json({
        message: 'Tipping request updated successfully',
        request: updatedRequest
      });
    } catch (error) {
      console.error('Error updating tipping request:', error);
      res.status(500).json({
        message: 'Failed to update tipping request',
        error: error.message,
      });
    }
  },

  markShippedWithProof: async (req, res) => {
    const userId = req.user._id;
    const { id } = req.params; // Required tipping request ID

    try {
      // Find the specific tipping request
      const request = await TippingRequest.findById(id);
      if (!request) {
        return res.status(404).json({ message: 'Tipping request not found' });
      }

      // Verify the request belongs to the current user
      if (request.userId.toString() !== userId.toString()) {
        return res.status(403).json({
          message: 'Unauthorized: You can only update your own tipping requests'
        });
      }

      // Set truckId if it's not already set
      if (!request.truckId) {
        let truck = await Truck.findOne({ driverId: request.userId });
        if (!truck) {
          truck = await Truck.findOne({ helperId: request.userId });
        }
        if (truck) {
          request.truckId = truck._id;
        }
      }

      // Check if files were uploaded
      if (req.files && req.files.length > 0) {
        // Extract Cloudinary URLs from uploaded files
        const proofUrls = req.files.map(file => file.path);

        // Append new proof files to existing ones
        request.tippingProof = [...(request.tippingProof || []), ...proofUrls];
      }

      // Mark as shipped
      request.isShipped = true;
      await request.save();

      // Update daily sheet after marking as shipped
      await updateDailySheetForTippingRequest(request);

      // Populate the response with user and place information
      const populatedRequest = await TippingRequest.findById(request._id)
        .populate([
          { path: 'userId', select: 'username roleType' },
          { path: 'tippingPlace', select: 'name address' },
          { path: 'storagePlace', select: 'name address' }
        ]);

      res.status(200).json({
        message: 'Tipping request marked as shipped successfully' +
          (req.files && req.files.length > 0 ? ' with proof uploaded' : ''),
        request: populatedRequest,
        proofUrls: req.files ? req.files.map(file => file.path) : null
      });
    } catch (error) {
      console.error('Error in markShippedWithProof:', error);
      res.status(500).json({
        message: 'Failed to mark tipping request as shipped',
        error: error.message,
      });
    }
  },
};
module.exports = tippingController;
