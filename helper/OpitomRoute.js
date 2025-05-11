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
    // Find the truck by ID and populate the tasks for the specified date
    const truck = await Truck.findById(truckId).populate(`tasks.${date}`);

    if (!truck) {
      return { message: "Truck not found" };
    }

    // Get tasks from the truck's tasks map for the specified date
    const allTasks = truck.tasks.get(date);

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
    const jobs = tasks.map((task, index) => {
      const [lat, lng] = task.location.coordinates;
      return {
        id: index + 1, // Assign an ID to each task
        service: 300, // Example service time in seconds
        delivery: [1], // Default delivery capacity
        location: task.location.coordinates, // Corrected to [longitude, latitude]
        skills: [1], // Example skill required (customize as needed)
        time_windows: mapAvailabilityToTimeWindow(task.available) || defaultTimeWindow,
        taskId: task._id.toString()
      };
    });

    console.log("Prepared Jobs for Optimization:", jobs);

    // Prepare the vehicle (truck) data for optimization
    const vehicle = {
      id: 1,
      profile: "driving-car",
      start: truck.startingLocation || [-0.1278, 51.5074],
      end: truck.endingLocation || [-0.1278, 51.5074],
      capacity: [truck.loadCapacity || 500],
      skills: [1],
      time_window: [28800, 43200],
    };

    // Prepare the payload for OpenRouteService
    const payload = {
      jobs,
      vehicles: [vehicle],
    };

    // Call OpenRouteService API for route optimization
    const apiKey = "5b3ce3597851110001cf6248d6a4c3521dba4295815342c5e4498cf2 ";
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
    console.log("Optimized Data from OpenRouteService:", optimizedData);

    const optimizedSteps = optimizedData.routes[0].steps;
    console.log("Optimized Steps:", optimizedSteps);

    const unassignedTasks = optimizedData.unassigned;
    console.log("Unassigned Tasks:", unassignedTasks); // Log unassigned tasks

    // Create a map of location to task ID for fast lookup
    const locationToTaskMap = tasks.reduce((acc, task) => {
      const [lat, lng] = task.location.coordinates;
      acc[`${lat},${lng}`] = task._id;
      return acc;
    }, {});

    console.log("Location to Task Map:", locationToTaskMap);

    // Reorder tasks in truck based on optimized route
    const reorderedTasks = optimizedSteps
      .filter(step => step.type === "job")
      .map(step => {
        const taskId = locationToTaskMap[`${step.location[0]},${step.location[1]}`];
        return taskId;
      });

    console.log("Reordered Tasks:", reorderedTasks);

    // Handle unassigned tasks (if any)
    if (unassignedTasks && unassignedTasks.length > 0) {
      console.log("Handling Unassigned Tasks:", unassignedTasks);

      // Re-add unassigned tasks to the reordered list manually
      unassignedTasks.forEach(task => {
        // Ensure the unassigned task is correctly handled (as ObjectId)
        reorderedTasks.push(new mongoose.Types.ObjectId(task.id)); // Add unassigned task back to the list
      });
    }

    // Ensure tasks were successfully reordered before updating
    if (reorderedTasks && reorderedTasks.length > 0) {
      await Truck.findOneAndUpdate(
        { _id: truck._id },
        { $set: { [`tasks.${date}`]: reorderedTasks } },
        { new: true }
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
    } else {
      return { message: "No valid tasks found for optimization" };
    }
  } catch (error) {
    console.error("Route Optimization Error:", error);
    return {
      message: "Failed to optimize route for the truck",
      error: error.message,
    };
  }
};








module.exports={createOptimoOrder , optimizeRoute}