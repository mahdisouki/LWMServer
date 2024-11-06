const axios = require('axios');
require('dotenv').config();  // To store your API key securely

// Function to map Task schema fields to OptimoRoute order format
async function createOptimoRouteOrder(task) {
  // Destructure task fields for easy access
  const {
    _id,
    firstName,
    lastName,
    phoneNumber,
    email,
    location,
    date,
    price,
    additionalNotes,
    clientFeedback,
    available,
  } = task;

  // Prepare the payload for OptimoRoute API
  const orderPayload = {
    operation: "CREATE",
    orderNo: _id.toString(),  // Convert MongoDB _id to string for orderNo
    type: "D",  // "D" for Delivery, "P" for Pickup (adjust if needed)
    date: date.toISOString().split("T")[0],  // Format date as YYYY-MM-DD
    location: {
      address: location?.address || "", // Use address if available
      latitude: location?.coordinates[1] || 0, // Latitude from coordinates
      longitude: location?.coordinates[0] || 0, // Longitude from coordinates
      acceptPartialMatch: true,  // Set geocoding options if needed
      acceptMultipleResults: true,
    },
    duration: 60,  // Duration in minutes (can adjust based on `timeSpent` or other logic)
    notes: additionalNotes || clientFeedback || "No additional notes provided",
    email: email,
    phone: phoneNumber,
    load1: price || 0,  // Load can be mapped to price or other fields
    timeWindows: [{
      twFrom: available === "AnyTime" ? "07:00" : available.split('-')[0],  // Map to time window
      twTo: available === "AnyTime" ? "17:00" : available.split('-')[1],
    }],
  };

  // Call OptimoRoute API to create the order
  try {
    const response = await axios.post(`https://api.optimoroute.com/v1/create_order?key=${process.env.OPTIMOROUTE_API_KEY}`, orderPayload);
    console.log("Order created in OptimoRoute:", response.data);
  } catch (error) {
    console.error("Error creating order in OptimoRoute:", error.response ? error.response.data : error.message);
  }
}

// Usage example with a sample task object (replace with actual task data)
const sampleTask = {
  _id: "task1234567890",
  firstName: "John",
  lastName: "Doe",
  phoneNumber: "123-456-7890",
  email: "johndoe@example.com",
  location: {
    address: "393 Hanover St, Boston, MA 02113, USA",
    coordinates: [-71.0528824, 42.3651425],
  },
  date: new Date(),
  price: 100,
  additionalNotes: "Deliver at back door",
  available: "7am-12pm",
};

