const axios = require('axios');
const Task = require('../models/Task');
const Truck = require('../models/Truck');
const mongoose = require('mongoose')
require('dotenv').config();

const OPTIMOROUTE_API_KEY = process.env.OPTIMOROUTE_API_KEY;
const OPTIMOROUTE_API_URL = 'https://api.optimoroute.com/v1';

// Helper function to convert time window to OptimoRoute format
const convertTimeWindow = (availability) => {
  switch (availability) {
    case "7am-12pm":
      return { from: "07:00", to: "12:00" };
    case "12pm-5pm":
      return { from: "12:00", to: "17:00" };
    case "AnyTime":
    default:
      return { from: "08:00", to: "17:00" };
  }
};

// Helper function to create OptimoRoute orders
const createOptimoOrders = async (tasks) => {
  const orders = tasks.map((task, index) => {
    const timeWindow = convertTimeWindow(task.available);
    return {
      orderNo: task.orderNumber,
      date: task.date.toISOString().split('T')[0],
      duration: 30, // Default duration in minutes
      priority: "M", // Medium priority
      type: "T", // Type T for task
      location: {
        address: task.location.address,
        latitude: task.location.coordinates[1],
        longitude: task.location.coordinates[0],
        notes: task.additionalNotes || ""
      },
      timeWindows: [timeWindow],
      notes: task.additionalNotes || "",
      email: task.email || "",
      phone: task.phoneNumber,
      customField1: task.taskStatus,
      customField2: task.paymentStatus,
      customField3: task.paymentMethod
    };
  });

  try {
    const response = await axios.post(
      `${OPTIMOROUTE_API_URL}/orders`,
      { orders },
      {
        params: { key: OPTIMOROUTE_API_KEY },
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPTIMOROUTE_API_KEY}`
        }
      }
    );

    if (response.data.success) {
      return response.data.orders;
    }
    throw new Error('Failed to create orders in OptimoRoute');
  } catch (error) {
    console.error('Error creating OptimoRoute orders:', error);
    throw error;
  }
};

// Helper function to create or update vehicle
const createOrUpdateVehicle = async (truck) => {
  const vehicle = {
    vehicleId: truck.name,
    name: truck.name,
    startLocation: {
      address: truck.startingLocation?.address || "Default Start Location",
      latitude: truck.startingLocation?.coordinates[1] || 51.5074,
      longitude: truck.startingLocation?.coordinates[0] || -0.1278
    },
    endLocation: {
      address: truck.endingLocation?.address || "Default End Location",
      latitude: truck.endingLocation?.coordinates[1] || 51.5074,
      longitude: truck.endingLocation?.coordinates[0] || -0.1278
    },
    timeWindow: {
      from: "08:00",
      to: "17:00"
    },
    capacity: truck.loadCapacity || 500,
    customField1: truck.registrationNumber || "",
    customField2: truck.model || ""
  };

  try {
    const response = await axios.post(
      `${OPTIMOROUTE_API_URL}/vehicles`,
      vehicle,
      {
        params: { key: OPTIMOROUTE_API_KEY },
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPTIMOROUTE_API_KEY}`
        }
      }
    );

    if (response.data.success) {
      return response.data.vehicle;
    }
    throw new Error('Failed to create/update vehicle in OptimoRoute');
  } catch (error) {
    console.error('Error creating/updating OptimoRoute vehicle:', error);
    throw error;
  }
};

// Helper function to start route planning
const startPlanning = async (date) => {
  try {
    const response = await axios.post(
      `${OPTIMOROUTE_API_URL}/planning/start`,
      { date },
      {
        params: { key: OPTIMOROUTE_API_KEY },
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPTIMOROUTE_API_KEY}`
        }
      }
    );

    if (response.data.success) {
      return response.data;
    }
    throw new Error('Failed to start planning in OptimoRoute');
  } catch (error) {
    console.error('Error starting OptimoRoute planning:', error);
    throw error;
  }
};

// Helper function to get routes
const getRoutes = async (date) => {
  try {
    const response = await axios.get(
      `${OPTIMOROUTE_API_URL}/routes`,
      {
        params: { 
          key: OPTIMOROUTE_API_KEY,
          date 
        },
        headers: { 
          'Authorization': `Bearer ${OPTIMOROUTE_API_KEY}`
        }
      }
    );

    if (response.data.success) {
      return response.data.routes;
    }
    throw new Error('Failed to get routes from OptimoRoute');
  } catch (error) {
    console.error('Error getting OptimoRoute routes:', error);
    throw error;
  }
};

const optimizeRoute = async (truckId, date) => {
  try {
    // Find the truck and its tasks
    const truck = await Truck.findById(truckId);
    if (!truck) {
      throw new Error('Truck not found');
    }

    // Get tasks for the specified date
    const tasks = await Task.find({
      _id: { $in: truck.tasks.get(date) || [] }
    });

    if (!tasks.length) {
      return { message: 'No tasks found for optimization' };
    }

    // Create or update vehicle in OptimoRoute
    await createOrUpdateVehicle(truck);

    // Create orders in OptimoRoute
    await createOptimoOrders(tasks);

    // Start planning
    await startPlanning(date);

    // Wait for planning to complete (you might want to implement a polling mechanism)
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Get optimized routes
    const routes = await getRoutes(date);

    // Find the route for this truck
    const truckRoute = routes.find(route => route.vehicleId === truck.name);
    if (!truckRoute) {
      throw new Error('No route found for this truck');
    }

    // Reorder tasks based on the optimized route
    const reorderedTasks = truckRoute.stops.map(stop => {
      const task = tasks.find(t => t.orderNumber === stop.orderNo);
      return task ? task._id : null;
    }).filter(id => id !== null);

    // Update truck's task order
    await Truck.findOneAndUpdate(
      { _id: truckId },
      { $set: { [`tasks.${date}`]: reorderedTasks } },
      { new: true }
    );

    return {
      message: 'Route optimized successfully',
      data: {
        route: truckRoute,
        tasks: reorderedTasks
      }
    };

  } catch (error) {
    console.error('Route optimization error:', error);
    return {
      message: 'Failed to optimize route',
      error: error.message
    };
  }
};

module.exports = { optimizeRoute };