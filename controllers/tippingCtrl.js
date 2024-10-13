const TippingRequest = require("../models/TippingRequest");
const { User } = require("../models/User");
const Truck = require("../models/Truck"); // Ensure this is correctly imported
const APIfeatures = require("../utils/APIFeatures"); // Adjust the path to the correct location

// class APIfeatures {
//   constructor(query, queryString) {
//     this.query = query;
//     this.queryString = queryString;
//     this.total = 0;
//   }
//   async filtering() {
//     const queryObj = { ...this.queryString };
//     const excludedFields = ["page", "sort", "limit"];
//     excludedFields.forEach((el) => delete queryObj[el]);

//     let queryStr = JSON.stringify(queryObj);
//     queryStr = queryStr.replace(
//       /\b(gte|gt|lt|lte|regex)\b/g,
//       (match) => "$" + match
//     );

//     let countQuery = this.query.clone();

//     this.query = this.query.find(JSON.parse(queryStr));
//     countQuery = countQuery.find(JSON.parse(queryStr));

//     this.total = await countQuery.countDocuments();

//     return this;
//   }

//   sorting() {
//     if (this.queryString.sort) {
//       const sortBy = this.queryString.sort.split(",").join(" ");
//       this.query = this.query.sort(sortBy);
//     } else {
//       this.query = this.query.sort("-createdAt");
//     }

//     return this;
//   }
//   paginating() {
//     const page = parseInt(this.queryString.page, 10) || 1;
//     const limit = parseInt(this.queryString.limit, 10) || 9;
//     const skip = (page - 1) * limit;
//     this.query = this.query.skip(skip).limit(limit);

//     return this;
//   }
// }
const tippingController = {
  createTippingRequest: async (req, res) => {
    const userId = req.user._id;
    const { truckName, notes } = req.body;

    try {
      const user = await User.findById(userId);
      if (!user || (user.roleType !== "Driver" && user.roleType !== "Helper")) {
        return res.status(403).json({
          message:
            "Unauthorized: Only drivers and helpers can make tipping requests.",
        });
      }
      const truck = await Truck.findOne({ name: truckName });
      if (!truck) {
        return res.status(404).json({ message: "Truck not found" });
      }
      const newTippingRequest = new TippingRequest({
        userId: userId,
        truckId: truck._id,
        notes: notes,
        status: "Pending",
      });

      await newTippingRequest.save();
      const response = {
        message: "Tipping request created successfully",
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
      console.error("Error in creating tipping request:", error);
      res.status(500).json({
        message: "Failed to create tipping request",
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
        message: "Failed to retrieve tipping requests",
        error: error.message,
      });
    }
  },

  getTippingRequestById: async (req, res) => {
    const { id } = req.params;
    try {
      const request = await TippingRequest.findById(id);
      if (!request) {
        return res.status(404).json({ message: "Tipping request not found" });
      }
      res.status(200).json({ request });
    } catch (error) {
      res.status(500).json({
        message: "Failed to retrieve tipping request",
        error: error.message,
      });
    }
  },

  updateTippingRequest: async (req, res) => {
    const { id } = req.params;
    const { truckName, notes } = req.body;
    const userId = req.user._id;

    try {
      // Ensure the request belongs to the logged-in user or the user is an admin
      const request = await TippingRequest.findOne({ _id: id, userId: userId });
      if (!request) {
        return res.status(404).json({
          message: "Tipping request not found or not yours to update",
        });
      }
      if (truckName) {
        const truck = await Truck.findOne({ name: truckName });
        if (!truck) {
          return res.status(404).json({ message: "Truck not found" });
        }
        request.truckId = truck._id;
      }
      if (notes) {
        request.notes = notes;
      }

      await request.save();
      res
        .status(200)
        .json({ message: "Tipping request updated successfully", request });
    } catch (error) {
      res.status(500).json({
        message: "Failed to update tipping request",
        error: error.message,
      });
    }
  },

  deleteTippingRequest: async (req, res) => {
    const { id } = req.params;
    try {
      const deletedRequest = await TippingRequest.findByIdAndDelete(id);
      if (!deletedRequest) {
        return res.status(404).json({ message: "Tipping request not found" });
      }
      res.status(200).json({ message: "Tipping request deleted successfully" });
    } catch (error) {
      res.status(500).json({
        message: "Failed to delete tipping request",
        error: error.message,
      });
    }
  },

  getAllTippingRequestsForAdmin: async (req, res) => {
    try {
      const { page = 1, limit = 9, filters } = req.query;

      // Base query to find all tipping requests
      let query = TippingRequest.find();

      // Initialize APIfeatures with the base query and request query parameters
      const features = new APIfeatures(query, req.query);

      // Apply filtering if filters are provided
      if (filters) {
        features.filtering();
      }

      // Apply sorting and pagination
      features.sorting().paginating();

      // Execute the query to get the filtered, sorted, and paginated requests
      let requests = await features.query.exec();

      // Get the total number of documents for pagination purposes
      const total = await TippingRequest.countDocuments(
        features.query.getFilter()
      );

      // Fetch additional data for each request (user and truck)
      requests = await Promise.all(
        requests.map(async (request) => {
          const requestObj = request.toObject();

          // Fetch the user's username based on userId
          if (request.userId) {
            const user = await User.findById(request.userId);
            requestObj.username = user ? user.username : "Unknown User";
          }

          // Fetch the truck name based on truckId
          if (request.truckId) {
            const truck = await Truck.findById(request.truckId);
            requestObj.truckName = truck ? truck.name : "Unknown Truck";
          }

          return requestObj;
        })
      );

      // Calculate current page and limit
      const currentPage = parseInt(req.query.page, 10) || 1;
      const limitNum = parseInt(req.query.limit, 10) || 9;

      // Send the response with requests and pagination meta data
      res.status(200).json({
        message: "All tipping requests retrieved successfully",
        requests, // The tipping requests with username and truckName
        meta: {
          currentPage,
          limit: limitNum,
          total,
          count: requests.length,
        },
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to retrieve all tipping requests",
        error: error.message,
      });
    }
  },

  // Update the status of a tipping request (Admin only)
  updateTippingRequestStatus: async (req, res) => {
    const { id } = req.params; // ID of the tipping request
    const { status } = req.body; // New status to be set

    try {
      const request = await TippingRequest.findById(id);
      if (!request) {
        return res.status(404).json({ message: "Tipping request not found" });
      }

      request.status = status; // Setting the new status
      await request.save();
      res.status(200).json({
        message: "Tipping request status updated successfully",
        request,
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to update tipping request status",
        error: error.message,
      });
    }
  },
};
module.exports = tippingController;
