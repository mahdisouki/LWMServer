const axios = require('axios');
const Task = require('../models/Task');
const Truck = require('../models/Truck');
const mongoose = require('mongoose')
require('dotenv').config();  // To store your API key securely

async function createOptimoOrder(apiKey, reqBody) {
  try {
    // Make the POST request to the API
    const response = await axios.post('https://api.optimoroute.com/v1/create_order', reqBody, {
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

const optimizeRoute = async (truckId , date) => {
  console.log(truckId);
  try {
    // Find the truck by ID
    const truck = await Truck.findById(truckId).populate(`tasks.${date}`); // Adjust the date as needed

    if (!truck) {
      return { message: "Truck not found" };
    }

    // Get tasks from the truck
    const allTasks = truck.tasks.get(date); // Example date (use dynamic date as needed)

    if (!allTasks || allTasks.length === 0) {
      return { message: "No tasks assigned to this truck for the specified date" };
    }
    
    // Fetch full task details
    const tasks = await Task.find({ _id: { $in: allTasks } });
    const defaultTimeWindow = [[28800, 63000]];
    const mapAvailabilityToTimeWindow = (availability) => {
      switch (availability) {
        case "7am-12pm":
          return [[25200, 43200]]; 
        case "12pm-5pm":
          return [[43200, 61200]]; 
        case "AnyTime":
        default:
          return [[28800, 75600]]; 
      }
    };
    // Prepare jobs (tasks) data for optimization
    console.log(tasks.length)
    const jobs = tasks.map((task, index) => {
      const [lat, lng] = task.location.coordinates;
      console.log("*****************",task._id.toString()) // Assuming coordinates are stored as [latitude, longitude]
      return {
        id: index+1,
        service: 300, // Example service time in seconds
        delivery: [1], // Default delivery capacity
        location: task.location.coordinates, // Corrected to [longitude, latitude]
        skills: [1], // Example skill required (customize as needed)
        time_windows: mapAvailabilityToTimeWindow(task.available) || defaultTimeWindow, // Use task's time window or default
        taskId: task._id.toString()
      };
    });
    console.log(jobs)
    // Prepare the vehicle (truck) data
    const vehicle = {
      id: 1, // Single vehicle, so ID is 1
      profile: "driving-car",
      start: truck.startingLocation || [-0.1278, 51.5074], // Starting location
      end: truck.endingLocation || [-0.1278, 51.5074], // Ending location
      capacity: [truck.loadCapacity || 5], // Truck capacity
      skills: [1], // Skills available for this truck
      time_window: [28800, 43200], // Truck's time window (default example)
    };

    // Prepare the payload for OpenRouteService
    const payload = {
      jobs,
      vehicles: [vehicle], // Single truck
    };

    // Call OpenRouteService API
    const apiKey = "5b3ce3597851110001cf6248d6a4c3521dba4295815342c5e4498cf2";
    const response = await axios.post(
      `https://api.openrouteservice.org/optimization`,
      payload,
      {
        headers: {
          Authorization: apiKey,
        },
      }
    );

    const optimizedData = response.data;

     // Match tasks based on the location (coordinates)
     const optimizedSteps = optimizedData.routes[0].steps;
    
     // Create a map of location to task ID for fast lookup
     const locationToTaskMap = tasks.reduce((acc, task) => {
       const [lat, lng] = task.location.coordinates;
       acc[`${lat},${lng}`] = task._id;
       return acc;
     }, {});
     console.log("locationToTaskMap:" , locationToTaskMap)
     console.log(optimizedSteps)
     // Reorder tasks in truck based on optimized route
     const reorderedTasks = optimizedSteps
       .filter(step => step.type === "job") // Only consider job steps
       .map(step => {
         const taskId = locationToTaskMap[`${step.location[0]},${step.location[1]}`]; // Match using lat,lng
         return taskId;
       });
       console.log("reorderedTasks:" , reorderedTasks)
     // Update truck's tasks order
     if (!truck.tasks){
      return { message: "Truck not found" };
     }
     await Truck.findOneAndUpdate(
      { _id: truck._id }, // Query to find the truck
      { $set: { [`tasks.${date}`]: reorderedTasks } }, // Update the specific key in the tasks map
      { new: true } // Return the updated document
    )
      .then((updatedTruck) => {
        console.log("Updated Truck:", updatedTruck);
      })
      .catch((error) => {
        console.error("Error updating truck:", error);
      });

    return {
      message: "Route optimized successfully for the truck",
      data: optimizedData,
    };
  } catch (error) {
   
    console.error("Route Optimization Error:", error);
    return {
      message: "Failed to optimize route for the truck",
      error: error.message,
    };
  }
};





module.exports={createOptimoOrder , optimizeRoute}