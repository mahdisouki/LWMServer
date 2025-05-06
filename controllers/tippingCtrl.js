const TippingRequest = require('../models/TippingRequest');
const { User } = require('../models/User');
const Truck = require('../models/Truck');
const APIfeatures = require('../utils/APIFeatures');
const { emitEvent } = require('../socket');
const Driver = require('../models/Driver');
const TippingPlace = require('../models/TippingPlaces');
const paginateQuery = require('../utils/paginationHelper');

const tippingController = {
  createTippingRequest: async (req, res) => {
    const userId = req.user._id;
    const { truckId, notes } = req.body;

    try {
      const user = await User.findById(userId);
      if (!user || (user.roleType !== 'Driver' && user.roleType !== 'Helper')) {
        return res.status(403).json({
          message:
            'Unauthorized: Only drivers and helpers can make tipping requests.',
        });
      }
      const truck = await Truck.findById(truckId);

      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      const newTippingRequest = new TippingRequest({
        userId: userId,
        truckId: truck._id,
        notes: notes,
        status: 'Pending',
      });

      await newTippingRequest.save();
      const response = {
        message: 'Tipping request created successfully',
        request: {
          id: newTippingRequest._id,
          userId: newTippingRequest.userId.toString(),
          truckId: newTippingRequest.truckId.toString(),
          notes: newTippingRequest.notes,
          status: newTippingRequest.status,
          createdAt: newTippingRequest.createdAt,
          userName: user.username,
          truckName: truck.name,
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
    const { driverId, truckId, tippingPlace, notes , status } = req.body;

    try {
        // Ensure the user making the request is an admin
        const admin = await User.findById(adminId);
        if (!admin || admin.roleType !== 'Admin') {
            return res.status(403).json({
                message: 'Unauthorized: Only admins can create tipping requests.',
            });
        }

        // Find the driver
        const driver = await User.findById(driverId);
        if (!driver || driver.roleType !== 'Driver') {
            return res.status(404).json({ message: 'Driver not found' });
        }

        // Find the truck
        const truck = await Truck.findById(truckId);
        if (!truck) {
            return res.status(404).json({ message: 'Truck not found' });
        }

        // Create the tipping request
        const newTippingRequest = new TippingRequest({
            userId: driver._id, // Assigning the tipping request to the driver
            truckId: truck._id,
            tippingPlace: tippingPlace, // New field for tipping place
            notes: notes,
            status: status,
            createdBy: admin._id, // Storing the admin who created the request
        });

        await newTippingRequest.save();

        const response = {
            message: 'Tipping request created successfully by admin',
            request: {
                id: newTippingRequest._id,
                driverId: newTippingRequest.userId.toString(),
                truckId: newTippingRequest.truckId.toString(),
                tippingPlace: newTippingRequest.tippingPlace,
                notes: newTippingRequest.notes,
                status: newTippingRequest.status,
                createdAt: newTippingRequest.createdAt,
                createdBy: admin.username, // Admin's name
                driverName: driver.username, // Driver's name
                truckName: truck.name, // Truck's name
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
      const requests = await TippingRequest.findOne({
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
      const deletedRequest = await TippingRequest.findByIdAndDelete(id);
      if (!deletedRequest) {
        return res.status(404).json({ message: 'Tipping request not found' });
      }
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
      const { keyword } = req.query;

      const { data, meta } = await paginateQuery(
        TippingRequest,
        req.query,
        ['collectionDate', 'paymentStatus'],
        [],
      );

      const populatedData = await TippingRequest.populate(data, [
        { path: 'truckId', select: 'name' },
        { path: 'userId', select: 'username' },
        { path: 'tippingPlace', select: 'name' },
      ]);

      let filteredData = populatedData;
      if (keyword) {
        const lowerKeyword = keyword.toLowerCase();
        filteredData = populatedData.filter((req) => {
          const truckName = req.truckId?.name?.toLowerCase() || '';
          const username = req.userId?.username?.toLowerCase() || '';
          const tippingPlace = req.tippingPlace?.name?.toLowerCase() || '';
          return (
            truckName.includes(lowerKeyword) ||
            username.includes(lowerKeyword) ||
            tippingPlace.includes(lowerKeyword)
          );
        });
      }

      const enrichedRequests = filteredData.map((req) => {
        const obj = req.toObject();
        obj.username = req.userId?.username ?? 'Unknown User';
        obj.truckName = req.truckId?.name ?? 'Unknown Truck';
        return obj;
      });

      res.status(200).json({
        message: 'All tipping requests retrieved successfully',
        requests: enrichedRequests,
        meta: {
          ...meta,
          count: enrichedRequests.length,
        },
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve all tipping requests',
        error: error.message,
      });
    }
  },

  // Update the status of a tipping request (Admin only)
  updateTippingRequestStatus: async (req, res) => {
    const { id } = req.params; // ID of the tipping request
    const { status, tippingPlace } = req.body; // New status to be set

    try {
      // Fetch the tipping request and populate truck to access helperId
      const request = await TippingRequest.findById(id).populate({
        path: 'truckId',
        select: 'helperId', // Only fetch helperId from the truck
        model: 'Truck',
      });

      if (!request) {
        return res.status(404).json({ message: 'Tipping request not found' });
      }

      const helperId = request.truckId.helperId;

      // Update status
      request.status = status;
      request.tippingPlace = tippingPlace
      await request.save();

      if (status === 'GoToTipping' || status === 'TippingAndStorage') {
        // Fetch the driver's location
        const driver = await Driver.findById(request.userId).select('location');

        if (driver) {
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
    const { truckId } = req.body;
    try {
      const request = await TippingRequest.findOne({
        truckId,
        isShipped: false,
      }).sort({ createdAt: -1 });

      if (!request) {
        return res.status(404).json({ message: 'Tipping request not found' });
      }

      request.isShipped = true;
      await request.save();

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

      // Extract Cloudinary URLs from uploaded files
      const proofUrls = req.files.map(file => file.path);

      // Append new proof files to existing ones
      request.tippingProof = [...(request.tippingProof || []), ...proofUrls];
      request.isShipped = true;
      await request.save();

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
          operatingHours:place.operatingHours,
          itemsAllowed:place.itemsAllowed,
          itemsNotAllowed:place.itemsNotAllowed,
          daysClosed:place.daysClosed
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
};
module.exports = tippingController;
