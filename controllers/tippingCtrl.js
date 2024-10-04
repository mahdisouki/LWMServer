const TippingRequest = require('../models/TippingRequest');
const {User} = require('../models/User');
const Truck = require('../models/Truck'); // Ensure this is correctly imported



const tippingController = { 
    createTippingRequest : async (req, res) => {
        const userId = req.user._id; 
    const { truckName, notes } = req.body;
    
    try {
        // Retrieve user to confirm role and get name
        const user = await User.findById(userId);
        if (!user || (user.roleType !== 'Driver' && user.roleType !== 'Helper')) {
            return res.status(403).json({ message: "Unauthorized: Only drivers and helpers can make tipping requests." });
        }

        // Find the truck by name to get the truckId
        const truck = await Truck.findOne({ name: truckName });
        if (!truck) {
            return res.status(404).json({ message: "Truck not found" });
        }

        // Create a new Tipping Request with the truckId from the truck found
        const newTippingRequest = new TippingRequest({
            userId: userId,
            truckId: truck._id,
            notes: notes,
            status: 'Pending', // Default or as per body
        });

        await newTippingRequest.save();

        // Constructing the response object explicitly for clarity
        const response = {
            message: "Tipping request created successfully",
            request: {
                id: newTippingRequest._id,
                userId: newTippingRequest.userId.toString(),
                truckId: newTippingRequest.truckId.toString(),
                notes: newTippingRequest.notes,
                status: newTippingRequest.status,
                createdAt: newTippingRequest.createdAt,
                userName: user.username, // User's name from the User model
                truckName: truck.name // Truck's name from the Truck model
            }
        };

        // Sending JSON response
        res.status(201).json(response);
    } catch (error) {
        console.error("Error in creating tipping request:", error);
        res.status(500).json({ message: "Failed to create tipping request", error: error.message });
    }
},
getAllTippingRequestsForUser: async (req, res) => {
    const userId = req.user._id;
    try {
        const requests = await TippingRequest.find({ userId });
        res.status(200).json({ requests });
    } catch (error) {
        res.status(500).json({ message: "Failed to retrieve tipping requests", error: error.message });
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
        res.status(500).json({ message: "Failed to retrieve tipping request", error: error.message });
    }
},

updateTippingRequest : async (req, res) => {
    const { id } = req.params;
    const { truckName, notes } = req.body;
    const userId = req.user._id; // Assuming `req.user._id` contains the ID of the logged-in user

    try {
        // Ensure the request belongs to the logged-in user or the user is an admin
        const request = await TippingRequest.findOne({ _id: id, userId: userId });
        if (!request) {
            return res.status(404).json({ message: "Tipping request not found or not yours to update" });
        }

        // Check and update truckName if provided
        if (truckName) {
            const truck = await Truck.findOne({ name: truckName });
            if (!truck) {
                return res.status(404).json({ message: "Truck not found" });
            }
            request.truckId = truck._id; // Update the truck ID if a new truck name is provided
        }

        // Update notes if provided
        if (notes) {
            request.notes = notes;
        }

        await request.save(); // Save the updated request
        res.status(200).json({ message: "Tipping request updated successfully", request });
    } catch (error) {
        res.status(500).json({ message: "Failed to update tipping request", error: error.message });
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
        res.status(500).json({ message: "Failed to delete tipping request", error: error.message });
    }
},

getAllTippingRequestsForAdmin : async (req, res) => {
   
    try {
        const requests = await TippingRequest.find({}); // Retrieves all requests without filtering by user
        res.status(200).json({ requests });
    } catch (error) {
        res.status(500).json({ message: "Failed to retrieve all tipping requests", error: error.message });
    }
},

// Update the status of a tipping request (Admin only)
updateTippingRequestStatus : async (req, res) => {
    const { id } = req.params; // ID of the tipping request
    const { status } = req.body; // New status to be set

    try {
        const request = await TippingRequest.findById(id);
        if (!request) {
            return res.status(404).json({ message: "Tipping request not found" });
        }

        request.status = status; // Setting the new status
        await request.save();
        res.status(200).json({ message: "Tipping request status updated successfully", request });
    } catch (error) {
        res.status(500).json({ message: "Failed to update tipping request status", error: error.message });
    }
},

};
module.exports = tippingController;