const axios = require('axios');
require('dotenv').config();  // To store your API key securely

async function createOptimoOrder(apiKey, reqBody) {
  try {
    // Make the POST request to the API
    const response = await axios.post('https://api.optimoroute.com/v1/create_or_update_orders', reqBody, {
      params: {
        key: apiKey, // API Key as a query parameter
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Handle the response
    const { data } = response;
    if (data.success) {
      console.log('Orders processed successfully:', data.orders);
      return data.orders;
    } else {
      console.error('Error occurred while processing orders:', data);
      return null;
    }
  } catch (error) {
    console.error('Error making API request:', error.message);
    return null;
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

module.exports={createOptimoOrder}