const Dayoff = require('../models/Dayoff');
const {User} = require("../models/User");

const dayOffController = {
    requestDayOff: async (req, res) => {
        const userId = req.user._id;
        const { startDate, endDate, reason } = req.body;
    
        try {
            const user = await User.findById(userId);
            if (!user || (user.roleType !== 'Driver' && user.roleType !== 'Helper')) {
                return res.status(403).json({ message: "Unauthorized: Only drivers and helpers can make day off requests." });
            }
    
            // Create a new day-off request
            const newDayOffRequest = new Dayoff({
                userId,
                startDate: new Date(startDate), // Convert string to Date
                endDate: new Date(endDate), // Convert string to Date
                reason
            });
    
            // Save the new day-off request
            await newDayOffRequest.save();
    
            // Push the day-off request ID to the user's dayOffRequests array
            user.dayOffRequests.push(newDayOffRequest._id);
            await user.save();
    
            res.status(201).json({ message: "Day off request submitted successfully", request: newDayOffRequest });
        } catch (error) {
            console.error("Error in requestDayOff:", error);
            res.status(500).json({ message: "Failed to create day off request", error: error.toString() });
        }
    },
    
    getAllDayOffRequests: async (req, res) => {
      const userId = req.user._id; // Extract userId from the request object, provided by your authentication middleware
      try {
          // Find day off requests only for the logged-in user
          const requests = await Dayoff.find({ userId: userId });
          res.status(200).json({ message: "Day off requests retrieved successfully", requests });
      } catch (error) {
          res.status(500).json({ message: "Failed to retrieve day off requests", error: error.message });
      }
  },

    getDayOffRequestById: async (req, res) => {
        const { requestId } = req.params;
        try {
            const request = await Dayoff.findById(requestId);
            if (!request) {
                return res.status(404).json({ message: "Day off request not found" });
            }
            res.status(200).json({ message: "Day off request retrieved successfully", request });
        } catch (error) {
            res.status(500).json({ message: "Failed to retrieve day off request", error: error.message });
        }
    },

    updateDayOffRequest: async (req, res) => {
      const { requestId } = req.params;
      const { startDate, endDate, reason } = req.body; // Allow users to update these fields only
      const userId = req.user._id;

      try {
          // Ensure the request belongs to the logged-in user
          const request = await Dayoff.findOne({ _id: requestId, userId: userId });
          if (!request) {
              return res.status(404).json({ message: "Day off request not found or not yours to update" });
          }

          request.startDate = startDate || request.startDate;
          request.endDate = endDate || request.endDate;
          request.reason = reason || request.reason;
          
          await request.save();

          res.status(200).json({ message: "Day off request updated successfully", request });
      } catch (error) {
          res.status(500).json({ message: "Failed to update day off request", error: error.message });
      }
  },

  deleteDayOffRequest: async (req, res) => {
    const { requestId } = req.params;
    

    try {
        const request = await Dayoff.findByIdAndDelete(requestId);;
        if (!request) {
            return res.status(404).json({ message: "Day off request not found" });
        }
        res.status(200).json({ message: "Day off request deleted successfully" });
    } catch (error) {
        console.error("Error in deleteDayOffRequest:", error);
        res.status(500).json({ message: "Failed to delete day off request", error: error.message });
    }
},


getAllDayOffRequests: async (req, res) => {
    try {
      const { page = 1, limit = 10 } = req.query; // Default page and limit values
  
      const total = await Dayoff.countDocuments(); // Count total documents
      const requests = await Dayoff.find({})
                                    .populate({
                                        path: 'userId',
                                        select: 'id email username'
                                    })
                                   .skip((page - 1) * limit) // Skip the previous pages' documents
                                   .limit(limit) // Limit the number of documents returned
                                   .exec(); // Execute the query
  
      const currentPage = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
  
      res.status(200).json({
        message: "Day off requests retrieved successfully",
        requests,
        meta: {
          currentPage,
          limit: limitNum,
          total,
          count: requests.length
        }
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to retrieve day off requests", error: error.message });
    }
  },
  

      updateDayOffRequestStatus: async (req, res) => {
        const { id } = req.params; // Request ID
        const { status } = req.body; // Only allow status updates

      

        try {
            const updatedRequest = await Dayoff.findByIdAndUpdate(id, { status }, { new: true });
            if (!updatedRequest) {
                return res.status(404).json({ message: "Day off request not found" });
            }
            res.status(200).json({ message: "Day off request status updated successfully", request: updatedRequest });
        } catch (error) {
            res.status(500).json({ message: "Failed to update day off request", error: error.message });
        }
    },
};

module.exports = dayOffController;