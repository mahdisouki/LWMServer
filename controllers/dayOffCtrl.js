const Dayoff = require('../models/Dayoff');
const { User } = require("../models/User");
const { emitNotificationToUser } = require('../socket');
const adminId = "67cb6810c9e768ec25d39523"
const dayOffController = {
    requestDayOff: async (req, res) => {
        const userId = req.user._id;
        const { startDate, endDate, reason } = req.body;
        console.log("Requesting day off:", { userId, startDate, endDate, reason });
        try {
            const user = await User.findById(userId);
            if (!user || (user.roleType !== 'Driver' && user.roleType !== 'Helper')) {

                return res.status(403).json({ message: "Unauthorized: Only drivers and helpers can make day off requests." });
            }
            const today = new Date();
            const tenDaysFromNow = new Date();
            tenDaysFromNow.setDate(today.getDate() + 10);

            const start = new Date(startDate);
            if (start < tenDaysFromNow) {
                console.log("Start date is less than 10 days from now:", start, tenDaysFromNow);
                return res.status(400).json({ message: "You must give at least 10 days notice." });
            }

            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

            // 1. Get all approved day-offs this month
            const approvedRequests = await Dayoff.find({
                userId,
                status: 'Approved',
                startDate: { $lte: endOfMonth },
                endDate: { $gte: startOfMonth }
            });

            // 2. Count how many total days the user has already been approved
            let approvedDaysCount = 0;
            approvedRequests.forEach(req => {
                const from = req.startDate < startOfMonth ? startOfMonth : req.startDate;
                const to = req.endDate > endOfMonth ? endOfMonth : req.endDate;
                const days = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
                approvedDaysCount += days;
            });

            // 3. Calculate how many days the new request spans
            const newStart = new Date(startDate);
            const newEnd = new Date(endDate);
            const newRequestDays = Math.ceil((newEnd - newStart) / (1000 * 60 * 60 * 24)) + 1;

            // 4. Enforce the 3-day-per-month limit
            const remainingDays = 3 - approvedDaysCount;
            if (remainingDays <= 0) {
                console.log("User has already used 3 approved days this month:", approvedDaysCount);
                return res.status(400).json({ message: "You have already used your 3 approved day-off days this month." });
            }

            if (newRequestDays > remainingDays) {
                console.log("New request days exceed remaining days:", newRequestDays, remainingDays);
                return res.status(400).json({ message: `You can only request ${remainingDays} more day(s) off this month.` });
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
            emitNotificationToUser(adminId, 'Day_Off', `${user.username} is requesting a day off`, user.username)
            res.status(201).json({ message: "Day off request submitted successfully", request: newDayOffRequest });
        } catch (error) {
            console.log("Error in requestDayOff:", error);
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
    addDayOffForUser: async (req, res) => {
        const { userId, startDate, endDate, reason } = req.body;

        try {
            const user = await User.findById(userId);
            if (!user || (user.roleType !== 'Driver' && user.roleType !== 'Helper')) {
                return res.status(404).json({ message: "User not found or not eligible for day off." });
            }

            const newDayOffRequest = new Dayoff({
                userId,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                reason,
                status: 'Approved' // Automatically approve
            });

            await newDayOffRequest.save();
            console.log(user)
            user.dayOffRequests.push(newDayOffRequest._id);
            await user.save();

            res.status(201).json({ message: "Day off successfully added for user", request: newDayOffRequest });
        } catch (error) {
            console.error("Error in addDayOffForUser:", error);
            res.status(500).json({ message: "Failed to add day off for user", error: error.toString() });
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