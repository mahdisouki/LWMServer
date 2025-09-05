const BlockingDays = require('../models/BlockingDays');
const Task = require('../models/Task');
const Truck = require('../models/Truck');
const paypal = require('@paypal/checkout-server-sdk');
const mongoose = require('mongoose');
const { emitNotificationToUser } = require('../socket.js');
const paginateQuery = require('../utils/paginationHelper');
const {
  getPayPalOrderDetails,
  capturePayPalPayment,
  createPaypalPaymentLink,
  createStripePaymentLink,
  createStripePaymentIntent,
  createPayPalOrder,
  PayPalClient,
  calculateTotalPriceUpdate,
} = require('../services/paymentService.js');
const OrderLock = require('../models/Orderlock');
const { sendWasteTransferNoteEmail } = require('../services/emailsService');
const loggingService = require('../services/loggingService');
const NGROK_URL = 'https://londonwastemanagement.uk';
const Handlebars = require('handlebars');
const LOCK_DURATION = 30 * 60 * 1000;
const PaymentHistory = require('../models/PaymentHistory.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const sendPayementEmail = require('../utils/sendPayementEmail');
const sendPaymentConfirmationEmail = require('../utils/sendPayementRecivedEmail');
const StandardItem = require('../models/StandardItem'); // Ajustez le chemin si nécessaire
const { sendBookingConfirmationEmail } = require('../services/emailsService');
const path = require('path');
const fs = require('fs');
const { generateOfficialInvoicePDF } = require('../services/emailsService');
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

function validateBreakdown(breakdown) {
  if (
    !Array.isArray(breakdown) ||
    breakdown.some((item) => {
      return isNaN(parseFloat(item.price)) && isNaN(parseFloat(item.amount));
    })
  ) {
    console.error('Invalid breakdown: ', breakdown);
    throw new Error(
      'Breakdown is not valid or contains undefined prices or descriptions',
    );
  }
}
// Fonction auxiliaire pour traiter les événements de commande approuvés
async function calculateTotalPrice({
  standardItems = [],
  items = [], // Add items parameter for backward compatibility
  objects = [],
  customDiscountPercent,
  discountType,
  hasDiscount,
}) {
  let subtotal = 0;

  // 1. Add custom items (objects) - NO position fee
  if (objects && Array.isArray(objects)) {
    objects.forEach((customObject) => {
      if (customObject.object && customObject.price) {
        const itemTotal =
          Number(customObject.price) * (Number(customObject.quantity) || 1);
        subtotal += itemTotal;
      }
    });
  }

  // 2. Add standard items (with per-item custom price if present) + position fee
  // Use items if provided, otherwise fall back to standardItems for backward compatibility
  const itemsToProcess = items.length > 0 ? items : standardItems;

  if (itemsToProcess && Array.isArray(itemsToProcess)) {
    for (const item of itemsToProcess) {
      if (!item.standardItemId) continue;
      const standardItem = await StandardItem.findById(item.standardItemId);
      if (!standardItem) continue;

      // Calculate base item subtotal
      let price = Number(standardItem.price);
      const quantity = Number(item.quantity) || 1;

      // Always add position fee for standard items
      let positionFee = 0;
      if (item.Objectsposition === 'InsideWithDismantling') positionFee = 18;
      else if (item.Objectsposition === 'Inside') positionFee = 6;

      const itemSubtotal = price * quantity + positionFee;

      // Handle item-specific discount if discountType is "perItem"
      let finalItemTotal = itemSubtotal;
      if (
        hasDiscount &&
        discountType === 'perItem' &&
        typeof item.customPrice !== 'undefined' &&
        !isNaN(Number(item.customPrice))
      ) {
        finalItemTotal = Number(item.customPrice) * quantity;
      }

      subtotal += finalItemTotal;
    }
  }

  // 3. Apply percentage discount if discountType is "percentage"
  if (
    hasDiscount &&
    discountType === 'percentage' &&
    typeof customDiscountPercent !== 'undefined' &&
    !isNaN(customDiscountPercent) &&
    customDiscountPercent > 0
  ) {
    const percentageDiscount = (subtotal * customDiscountPercent) / 100;
    subtotal -= percentageDiscount;
  }

  // 4. Enforce minimum price (before VAT) - if under £30, make it £30
  if (subtotal < 30) {
    subtotal = 30;
  }

  // 5. Add VAT (20%)
  const vat = subtotal * 0.2;
  const totalPrice = subtotal + vat;

  return {
    totalPrice: Number(totalPrice.toFixed(2)),
    vat: Number(vat.toFixed(2)),
  };
}
function hasPerItemDiscount(arr) {
  if (!Array.isArray(arr)) return false;
  return arr.some(item =>
    item.customPrice !== undefined &&
    !isNaN(Number(item.customPrice)) &&
    Number(item.customPrice) > 0
  );
}

const taskCtrl = {
  createTask: async (req, res) => {
    try {
      const {
        firstName,
        lastName,
        bussinessName,
        phoneNumber,
        phoneNumber2,
        email,
        available,
        location,
        date,
        createdBy,
        createdByType,
        billingAddress,
        collectionAddress,
        objects, // Custom items (optional)
        items, // Standard items (from frontend)
        paymentStatus,
        paymentMethod,
        cloneClientObjectPhotos,
        postcode,
        customDiscountPercent,
        additionalNotes,
        privateNotes,
        discountType,
      } = req.body;

      // For debugging: see what you get from frontend
      console.log('Received items:', req.body.items);
      console.log('additionalNotes', additionalNotes);
      console.log('privateNotes', privateNotes);
      let clientObjectPhotos = [];
      if (cloneClientObjectPhotos) {
        clientObjectPhotos = cloneClientObjectPhotos;
      } else if (req.files && req.files.length > 0) {
        clientObjectPhotos = req.files.map((file) => file.path);
      }

      const taskDate = new Date(date);
      const hasDiscount =
        (customDiscountPercent !== undefined &&
          !isNaN(customDiscountPercent) &&
          customDiscountPercent > 0) ||
        hasPerItemDiscount(items) ||
        hasPerItemDiscount(objects);

      // Calculate price using new logic
      console.log('=== PRICE CALCULATION DEBUG ===');
      console.log('Items being passed to calculateTotalPrice:', items);
      console.log('Objects being passed to calculateTotalPrice:', objects);

      const { totalPrice, vat } = await calculateTotalPrice({
        items, // Pass items directly for the function
        objects,
        customDiscountPercent,
        discountType,
        hasDiscount,
        // customDiscountPercent !== undefined &&
        // !isNaN(customDiscountPercent) &&
        // customDiscountPercent > 0,
      });

      console.log('Calculated totalPrice:', totalPrice);
      console.log('Calculated vat:', vat);
      // Prepare items array for DB (merge standard and custom if needed)
      let allItems = [];
      if (items && Array.isArray(items)) {
        allItems.push(
          ...items.map((item) => ({
            standardItemId: item.standardItemId || null,
            quantity: Number(item.quantity) || 1,
            Objectsposition: item.Objectsposition || 'Outside',
            customPrice:
              item.customPrice !== undefined
                ? Number(item.customPrice)
                : undefined,
            object: item.object || undefined,
            price: item.price !== undefined ? Number(item.price) : undefined,
          })),
        );
      }
      // If you want to keep supporting "objects" as a separate array, merge them too:
      if (objects && Array.isArray(objects)) {
        console.log('objects', objects);
        allItems.push(
          ...objects.map((item) => ({
            object: item.object || null,
            quantity: Number(item.quantity) || 1,
            price: Number(item.price) || 0,
            customPrice:
              item.customPrice !== undefined
                ? Number(item.customPrice)
                : undefined,
            Objectsposition: item.Objectsposition || 'Outside',
          })),
        );
      }
      // // Nettoyer allItems avant de sauvegarder (anti NaN, 'undefined', etc)
      // allItems = allItems.map(item => {
      //   if (
      //     item.customPrice === '' ||
      //     item.customPrice === null ||
      //     item.customPrice === undefined ||
      //     item.customPrice === 'undefined' ||
      //     isNaN(Number(item.customPrice))
      //   ) {
      //     delete item.customPrice;
      //   } else {
      //     item.customPrice = Number(item.customPrice);
      //   }
      //   return item;
      // });

      // Create the task
      const newTask = new Task({
        firstName,
        lastName,
        bussinessName,
        phoneNumber,
        phoneNumber2,
        email,
        available,
        location,
        date: taskDate,
        createdBy,
        createdByType,
        paymentStatus,
        billingAddress,
        collectionAddress,
        paymentMethod,
        clientObjectPhotos,
        totalPrice,
        items: allItems,
        taskStatus: 'Processing',
        postcode,
        customDiscountPercent,
        discountType,
        hasDiscount,
        // customDiscountPercent !== undefined &&
        // !isNaN(customDiscountPercent) &&
        // customDiscountPercent > 0,
        additionalNotes,
        privateNotes,
      });

      const savedTask = await newTask.save();

      // Create a log of the task creation
      // await loggingService.createLog({
      //   userId: req.user._id,
      //   username: req.user.username,
      //   action: 'CREATE',
      //   entityType: 'TASK',
      //   entityId: savedTask._id,
      //   changes: {
      //     created: savedTask.toObject(),
      //   },
      //   ipAddress: req.ip,
      //   userAgent: req.headers['user-agent'],
      // });

      res.status(201).json({
        message: 'Task created successfully',
        task: newTask,
      });
    } catch (error) {
      console.log(error);
      res
        .status(400)
        .json({ message: 'Failed to create task', error: error.message });
    }
  },

  getTaskById: async (req, res) => {
    const { taskId } = req.params;

    try {
      const task = await Task.findById(taskId).populate(
        'createdBy',
        'email name',
      ); // optional fields;
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }
      res.status(200).json({ message: 'Task retrieved successfully', task });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to retrieve task', error: error.message });
    }
  },

  getAllTasks: async (req, res) => {
    try {
      const { data: tasks, meta } = await paginateQuery(
        Task,
        req.query,
        ['paymentStatus', 'date', 'orderNumber'], // filters
        [
          'firstName',
          'lastName',
          'email',
          'username',
          'phoneNumber',
          'postcode',
          'orderNumber',
        ], // searchable fields
      );

      const tasksWithTrucks = await Promise.all(
        tasks.map(async (task) => {
          if (task.truckId) {
            const truck = await Truck.findById(task.truckId);
            task = task.toObject();
            task.truckName = truck?.name ?? null;
          }
          return task;
        }),
      );

      res.status(200).json({
        message: 'All tasks retrieved successfully',
        tasks: tasksWithTrucks,
        meta: meta,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve tasks',
        error: error.message,
      });
    }
  },

  assignTruckToTask: async (req, res) => {
    const { taskId } = req.params;
    const { truckName } = req.body;

    try {
      const truck = await Truck.findOne({ name: truckName });
      if (!truck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      const task = await Task.findById(taskId);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      // Extract taskDate from the task's `date` field
      const taskDate = task.date.toISOString().split('T')[0]; // Format: 'YYYY-MM-DD'

      // Update the task with the truck ID
      task.truckId = truck._id;
      await task.save();

      // Ensure `tasks` exists for the truck
      if (!truck.tasks) {
        truck.tasks = new Map();
      }

      // Convert `truck.tasks` to a plain object to update it
      const tasksByDate =
        truck.tasks instanceof Map
          ? Object.fromEntries(truck.tasks)
          : truck.tasks;

      // Add the task ID to the specific date
      if (!tasksByDate[taskDate]) {
        tasksByDate[taskDate] = [];
      }

      if (!tasksByDate[taskDate].includes(task._id.toString())) {
        tasksByDate[taskDate].push(task._id.toString());
      }

      // Save the updated `tasks` field
      truck.tasks = new Map(Object.entries(tasksByDate));
      await truck.save();

      res.status(200).json({
        message: 'Truck assigned to task successfully',
        task,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to assign truck',
        error: error.message,
      });
    }
  },

  deAssignTaskFromTruck: async (req, res) => {
    const { taskId } = req.params;

    try {
      const task = await Task.findById(taskId);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      if (!task.truckId) {
        return res
          .status(400)
          .json({ message: 'Task is not assigned to any truck' });
      }

      const truck = await Truck.findById(task.truckId);
      if (!truck) {
        return res.status(404).json({ message: 'Assigned truck not found' });
      }

      const taskDate = task.date.toISOString().split('T')[0]; // Extract the task date

      // Convert `truck.tasks` (Map) to a plain object for manipulation
      const tasksByDate =
        truck.tasks instanceof Map
          ? Object.fromEntries(truck.tasks)
          : truck.tasks;

      // Check and remove the task ID from the specified date
      if (
        tasksByDate[taskDate] &&
        tasksByDate[taskDate].includes(task._id.toString())
      ) {
        tasksByDate[taskDate] = tasksByDate[taskDate].filter(
          (id) => id !== task._id.toString(),
        );

        // Remove the date entry if it becomes empty
        if (tasksByDate[taskDate].length === 0) {
          delete tasksByDate[taskDate];
        }
      }

      // Convert the updated tasks object back to a Map and save it
      truck.tasks = new Map(Object.entries(tasksByDate));
      await truck.save();

      // Remove the truck assignment from the task
      task.truckId = null;
      await task.save();

      res.status(200).json({
        message: 'Task de-assigned from truck successfully',
        task,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to de-assign task from truck',
        error: error.message,
      });
    }
  },

  moveTaskToAnotherTruck: async (req, res) => {
    const { taskId } = req.params;
    const { newTruckName } = req.body;

    try {
      // Find the task by ID
      const task = await Task.findById(taskId).populate('truckId');
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      // Find the current truck assigned to the task
      const currentTruck = await Truck.findById(task.truckId);
      if (!currentTruck) {
        return res.status(404).json({ message: 'Current truck not found' });
      }

      // Find the new truck by name
      const newTruck = await Truck.findOne({ name: newTruckName });
      if (!newTruck) {
        return res.status(404).json({ message: 'New truck not found' });
      }

      // Extract the task date
      const taskDate = task.date.toISOString().split('T')[0];

      // Remove the task from the current truck's tasks list
      if (currentTruck.tasks) {
        const currentTasksByDate = Object.fromEntries(currentTruck.tasks);

        if (currentTasksByDate[taskDate]) {
          currentTasksByDate[taskDate] = currentTasksByDate[taskDate].filter(
            (id) => id !== task._id.toString(),
          );

          // Remove the date entry if no tasks remain
          if (currentTasksByDate[taskDate].length === 0) {
            delete currentTasksByDate[taskDate];
          }
        }

        currentTruck.tasks = new Map(Object.entries(currentTasksByDate));
        await currentTruck.save();
      }

      // Add the task to the new truck's tasks list
      const newTasksByDate = newTruck.tasks
        ? Object.fromEntries(newTruck.tasks)
        : {};
      if (!newTasksByDate[taskDate]) {
        newTasksByDate[taskDate] = [];
      }

      if (!newTasksByDate[taskDate].includes(task._id.toString())) {
        newTasksByDate[taskDate].push(task._id.toString());
      }

      newTruck.tasks = new Map(Object.entries(newTasksByDate));
      await newTruck.save();

      // Update the task with the new truck ID
      task.truckId = newTruck._id;
      await task.save();

      res.status(200).json({
        message: 'Task moved to the new truck successfully',
        task,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to move task to another truck',
        error: error.message,
      });
    }
  },

  updateTaskOrderInTruck: async (req, res) => {
    const { truckId, date, reorderedTasks } = req.body;

    if (!truckId || !date || !Array.isArray(reorderedTasks)) {
      return res.status(400).json({ message: 'Invalid request data' });
    }

    try {
      const updatedTruck = await Truck.findOneAndUpdate(
        { _id: truckId }, // Query to find the truck
        { $set: { [`tasks.${date}`]: reorderedTasks } }, // Dynamically update the tasks for the specific date
        { new: true }, // Return the updated document
      );

      if (!updatedTruck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      res.status(200).json({
        message: 'Task order updated successfully',
        tasks: updatedTruck.tasks.get(date), // Get the updated tasks for the specific date
      });
    } catch (error) {
      console.error('Error updating truck:', error);
      res.status(500).json({
        message: 'Failed to update task order',
        error: error.message,
      });
    }
  },
  traiterTask: async (req, res) => {
    const { taskId } = req.params;
    const { taskStatus } = req.body;

    try {
      if (
        ![
          'Declined',
          'Processing',
          'Completed',
          'Cancelled',
          'On_Hold',
          'Not_Completed',
          'Completed',
        ].includes(taskStatus)
      ) {
        return res.status(400).json({ message: 'Invalid task status' });
      }

      const updatedTask = await Task.findByIdAndUpdate(
        taskId,
        { $set: { taskStatus } },
        { new: true },
      );

      if (!updatedTask) {
        return res.status(404).json({ message: 'Task not found' });
      }

      res.status(200).json({
        message: `Task ${taskStatus} successfully`,
        task: updatedTask,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update task status',
        error: error.message,
      });
    }
  },

  updateTask: async (req, res) => {
    try {
      const taskId = req.params.taskId;
      const updates = req.body;
      console.log('dddddddddddddddddddddddddddddddddddddddddd', req.body);
      const oldTask = await Task.findById(taskId);
      console.log('hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh');
      console.log('additionalNotes', updates.additionalNotes);
      console.log('privateNotes', updates.privateNotes);
      if (!oldTask) {
        return res.status(404).json({ message: 'Task not found' });
      }

      // If items are being updated, recalculate totalPrice
      if (updates.items) {
        // Clean and filter items
        updates.items = updates.items
          .map((item) => {
            // Convert empty string standardItemId to null
            if (item.standardItemId === '') {
              item.standardItemId = null;
            }
            return item;
          })
          .filter((item) => {
            // Keep items that have either:
            // 1. A valid standardItemId, or
            // 2. A non-empty object attribute (for custom items)
            return (
              (item.standardItemId &&
                typeof item.standardItemId === 'string' &&
                item.standardItemId.trim() !== '' &&
                mongoose.Types.ObjectId.isValid(item.standardItemId)) ||
              (item.object && item.object.trim() !== '')
            );
          });

        // Also handle objects array (custom items) if present
        if (updates.objects && Array.isArray(updates.objects)) {
          const customItems = updates.objects.map((obj) => ({
            standardItemId: null, // Custom items don't have standardItemId
            object: obj.object,
            Objectsposition: obj.Objectsposition || 'Outside',
            quantity: Number(obj.quantity) || 1,
            customPrice:
              obj.customPrice !== undefined
                ? Number(obj.customPrice)
                : undefined,
            price: Number(obj.price) || 0,
          }));

          // Merge items and custom items
          updates.items = [...updates.items, ...customItems];
        }

        console.log('Final items to save:', updates.items);

        // Save the new items first
        await Task.findByIdAndUpdate(taskId, {
          $set: { items: updates.items },
        });
        // Re-fetch the task with populated items
        const populatedTask = await Task.findById(taskId).populate(
          'items.standardItemId',
        );

        let subtotal = 0;

        // Calculate subtotal with discount handling
        for (const item of populatedTask.items) {
          let price = 0;
          const isCustomItem = !item.standardItemId; // Check if it's a custom item

          if (item.standardItemId && item.standardItemId.price) {
            price = Number(item.standardItemId.price);
          } else if (item.price) {
            price = Number(item.price);
          }
          const quantity = Number(item.quantity) || 1;

          // Only apply position fees to standard items (not custom items)
          let positionFee = 0;
          if (!isCustomItem) {
            if (item.Objectsposition === 'InsideWithDismantling')
              positionFee = 18;
            else if (item.Objectsposition === 'Inside') positionFee = 6;
          }

          const itemSubtotal = price * quantity + positionFee;

          // Handle item-specific discount if discountType is "perItem"
          let finalItemTotal = itemSubtotal;
          if (
            populatedTask.hasDiscount &&
            populatedTask.discountType === 'perItem' &&
            item.customPrice
          ) {
            finalItemTotal = item.customPrice * quantity + positionFee;
          }

          console.log(
            'Item:',
            item,
            'Price:',
            price,
            'Quantity:',
            quantity,
            'PositionFee:',
            positionFee,
            'ItemSubtotal:',
            itemSubtotal,
            'FinalItemTotal:',
            finalItemTotal,
          );

          subtotal += finalItemTotal;
        }

        // Handle percentage discount if discountType is "percentage"
        if (
          populatedTask.hasDiscount &&
          populatedTask.discountType === 'percentage' &&
          populatedTask.customDiscountPercent > 0
        ) {
          const percentageDiscount =
            (subtotal * populatedTask.customDiscountPercent) / 100;
          subtotal -= percentageDiscount;
          console.log(
            'Applied percentage discount:',
            percentageDiscount,
            'New subtotal:',
            subtotal,
          );
        }

        // Apply minimum price (before VAT) - if under £30, make it £30
        if (subtotal < 30) {
          console.log(
            'Applying minimum price adjustment: £' + subtotal + ' → £30',
          );
          subtotal = 30;
        }

        // Add VAT
        const vat = subtotal * 0.2;
        const totalPrice = subtotal + vat;

        console.log('Final subtotal:', subtotal);
        console.log('VAT:', vat);
        console.log('Calculated totalPrice with VAT:', totalPrice);

        updates.totalPrice = totalPrice;
      }

      // Before saving or updating a task, sanitize customPrice for all items
      if (updates.items) {
        updates.items = updates.items.map((item) => {
          if (
            item.customPrice === '' ||
            item.customPrice === null ||
            item.customPrice === undefined ||
            item.customPrice === 'undefined' ||
            typeof item.customPrice === 'undefined' ||
            isNaN(Number(item.customPrice))
          ) {
            delete item.customPrice;
          } else {
            item.customPrice = Number(item.customPrice);
          }
          return item;
        });
      }

      console.log(updates.totalPrice); // Update the task
      const updatedTask = await Task.findByIdAndUpdate(
        taskId,
        { $set: updates },
        { new: true },
      );

      // Create a log of the changes
      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'UPDATE',
        entityType: 'TASK',
        entityId: taskId,
        changes: {
          before: oldTask.toObject(),
          after: updatedTask.toObject(),
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(200).json({
        message: 'Task updated successfully',
        task: updatedTask,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update task',
        error: error.message,
      });
    }
  },

  updateTaskStatus: async (req, res) => {
    const { taskId } = req.params;
    const { action } = req.body;

    try {
      const task = await Task.findById(taskId);

      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      const now = new Date();

      if (action === 'mark_start') {
        task.startDate = now;
        task.taskStatus = 'Processing';
        await task.save();
        return res.status(200).json({
          message: 'Task marked as started successfully',
          task,
        });
      }

      if (action === 'mark_finish') {
        task.taskStatus = 'Completed';
        if (!task.startDate) {
          return res.status(400).json({
            message: "Task hasn't been started yet",
          });
        }

        if (
          !task.initialConditionPhotos ||
          task.initialConditionPhotos.length === 0
        ) {
          return res.status(400).json({
            message: 'Initial condition photos are required',
          });
        }

        if (
          !task.finalConditionPhotos ||
          task.finalConditionPhotos.length === 0
        ) {
          return res.status(400).json({
            message: 'Final condition photos are required',
          });
        }

        task.finishDate = now;
        const timeElapsed = (now - task.startDate) / 1000;

        task.timeSpent = timeElapsed;
        await task.save();

        return res.status(200).json({
          message: 'Task marked as finished successfully',
          task,
        });
      }

      return res.status(400).json({
        message:
          "Invalid action type. Please specify 'mark_start' or 'mark_finish'.",
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to update task status',
        error: error.message,
      });
    }
  },

  processTaskPayment: async (req, res) => {
    const { taskId } = req.params;
    const { paymentType, paymentAmountType } = req.body; // Add paymentAmountType

    try {
      const task = await Task.findById(taskId).populate('items.standardItemId');
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      // Build breakdown array
      const selectedQuantities = {};
      task.items.forEach((item) => {
        if (item.standardItemId) {
          // standardItemId is a string, not an object
          selectedQuantities[item.standardItemId.toString()] =
            item.quantity || 1;
        }
      });

      const breakdown = task.items.map((item) => {
        const itemQuantity =
          selectedQuantities[item.standardItemId?.toString()] ||
          item.quantity ||
          1;

        // Use the price from the frontend (which already includes position fees)
        const itemPrice = item.price || 0;

        return {
          itemDescription: item.object || 'Standard Item', // Use object field or default
          quantity: itemQuantity,
          price: itemPrice,
          Objectsposition: item.Objectsposition,
        };
      });

      let basePrice = breakdown.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0,
      );
      let additionalFees = 0;
      task.items.forEach((item) => {
        if (item.Objectsposition === 'InsideWithDismantling')
          additionalFees += 18;
        else if (item.Objectsposition === 'Inside') additionalFees += 6;
      });
      let finalPrice = basePrice + additionalFees;
      if (
        task.available === 'AnyTime' &&
        task.items.every((i) => i.Objectsposition === 'Outside')
      ) {
        finalPrice *= 0.9;
      }

      // Apply minimum price (before VAT) - if under £30, make it £30
      if (finalPrice < 30) {
        finalPrice = 30;
      }

      const vat = finalPrice * 0.2;
      finalPrice += vat;

      // Prepare fullBreakdown for PayPal
      const fullBreakdown = [
        ...breakdown,
        { description: 'VAT (20%)', amount: vat.toFixed(2) },
        { description: 'Final Total Price', amount: finalPrice.toFixed(2) },
      ];

      // --- NEW: Determine amount to pay based on paymentAmountType ---
      let amountToPay;
      if (paymentAmountType === 'deposit') {
        task.paymentStatus = 'partial_Paid';
        amountToPay = 36; // Set deposit amount
        task.paidAmount = {
          amount: 36,
          method: 'online',
          status: 'Not_Paid', // Will be updated to Paid after successful payment
        };
        task.remainingAmount = {
          amount: finalPrice - 36,
          method: 'online',
          status: 'Not_Paid',
        };
      } else {
        amountToPay = finalPrice; // Set full amount
        task.paidAmount = {
          amount: finalPrice,
          method: 'online',
          status: 'Not_Paid', // Will be updated to Paid after successful payment
        };
        task.remainingAmount = {
          amount: 0,
          method: 'online',
          status: 'Not_Paid',
        };
      }
      const amountInPence = Math.round(amountToPay * 100);

      await task.save();

      // --- Use amountToPay for Stripe/PayPal ---
      let paymentResult;
      switch (paymentType) {
        case 'stripe':
          try {
            const session = await stripe.checkout.sessions.create({
              payment_method_types: ['card'],
              mode: 'payment',
              line_items: [
                {
                  price_data: {
                    currency: 'GBP',
                    product_data: {
                      name: `Payment for Task ${taskId}`,
                      images: [
                        'https://res.cloudinary.com/dfxeaeebv/image/upload/v1742959873/slpany1oqx09lxj72nmd.png',
                      ],
                    },
                    unit_amount: amountInPence,
                  },
                  quantity: 1,
                },
              ],
              success_url: `${NGROK_URL}/api/webhooks/payment/success`,
              cancel_url: `${NGROK_URL}/api/webhooks/payment/cancel`,
              metadata: {
                taskId: taskId,
                paymentAmountType: paymentAmountType,
              },
            });

            return res.json({
              message: 'Stripe payment initiated successfully',
              redirectUrl: session.url,
              paymentIntentId: session.payment_intent,
            });
          } catch (error) {
            console.error('Stripe Error:', error);
            return res.status(500).json({
              message: 'Failed to initiate payment',
              error: error.message,
            });
          }

        case 'paypal':
          paymentResult = await createPayPalOrder(
            amountInPence,
            taskId,
            fullBreakdown,
            task,
          );
          return res.json({
            message: 'PayPal payment initiated successfully',
            orderID: paymentResult.result.id,
            approvalLink:
              paymentResult.result.links.find((link) => link.rel === 'approve')
                ?.href || null,
            amount: amountInPence,
            paymentType,
            paymentAmountType, // Return for frontend tracking
            breakdown: fullBreakdown,
          });

        default:
          return res.status(400).json({ message: 'Invalid payment method' });
      }
    } catch (error) {
      console.error('Payment Error:', error);
      return res
        .status(500)
        .json({ message: 'Failed to initiate payment', error: error.message });
    }
  },

  confirmStripeTaskPayment: async (req, res) => {
    const { paymentIntentId, paymentMethodId, taskId } = req.body;

    try {
      // Confirmer le paiement Stripe
      const paymentIntent = await stripe.paymentIntents.confirm(
        paymentIntentId,
        {
          payment_method: paymentMethodId,
        },
      );

      if (paymentIntent.status === 'succeeded') {
        const task = await Task.findById(taskId).populate(
          'items.standardItemId',
        );
        if (!task) return res.status(404).json({ message: 'Task not found' });

        task.paymentStatus = 'Paid';
        await task.save();

        // Montant en GBP
        const amountInCents = paymentIntent.amount;
        const amountInGBP = Number((amountInCents / 100).toFixed(2));

        // Récupérer les informations du paiement
        const charges = await stripe.charges.list({
          payment_intent: paymentIntentId,
          limit: 1,
        });
        const charge = charges.data[0];
        if (!charge) throw new Error('Charge not found for this payment');

        const payerAccount =
          charge.billing_details.email ||
          `Card ending in ${charge.payment_method_details.card.last4}`;

        // Construire le breakdown complet
        const breakdown = task.items.map((item) => ({
          itemDescription: item.standardItemId
            ? item.standardItemId.itemName
            : 'Custom Item',
          quantity: item.quantity || 1,
          price: item.standardItemId
            ? item.standardItemId.price
            : item.price || 0,
        }));

        // Ajouter le total et les détails de la méthode de paiement
        breakdown.push(
          { description: 'Total Amount (includes VAT)', amount: amountInGBP },
          { description: 'Payment Method', amount: payerAccount },
        );

        // Sauvegarder l'historique du paiement
        await PaymentHistory.create({
          taskId: task._id,
          firstName: task.firstName,
          lastName: task.lastName,
          phoneNumber: task.phoneNumber,
          amount: amountInCents,
          paymentType: 'Stripe',
          paymentDate: new Date(),
          transactionId: paymentIntentId,
          payerAccount,
        });

        // Envoyer l'email de confirmation
        await sendPaymentConfirmationEmail({
          email: task.email,
          firstName: task.firstName,
          lastName: task.lastName,
          orderId: taskId,
          paymentDate: new Date().toLocaleString(),
          amount: amountInGBP,
          currency: 'GBP',
          paymentType: 'Stripe',
          breakdown,
        });

        return res.status(200).json({
          message: 'Payment confirmed successfully and email sent',
          task,
        });
      } else {
        return res.status(400).json({
          message: 'Payment confirmation failed',
          status: paymentIntent.status,
        });
      }
    } catch (error) {
      console.error('Error confirming payment:', error);
      return res
        .status(500)
        .json({ message: 'Error confirming payment', error: error.message });
    }
  },
  capturePayPalTaskPayment: async (req, res) => {
    const { orderID, taskId } = req.body;

    try {
      const task = await Task.findById(taskId).populate('items.standardItemId');
      if (!task) return res.status(404).json({ message: 'Task not found' });

      const request = new paypal.orders.OrdersCaptureRequest(orderID);
      request.requestBody({});

      const capture = await PayPalClient().execute(request);

      if (capture.result.status === 'COMPLETED') {
        task.paymentStatus = 'Paid';
        task.status = 'Completed';
        await task.save();

        const amountInGBP = parseFloat(
          capture.result.purchase_units[0].payments.captures[0].amount.value,
        );
        const transactionId =
          capture.result.purchase_units[0].payments.captures[0].id;
        const payerAccount = capture.result.payer.email_address;

        // Construire le breakdown complet
        const breakdown = task.items.map((item) => ({
          itemDescription: item.standardItemId
            ? item.standardItemId.itemName
            : 'Custom Item',
          quantity: item.quantity || 1,
          price: item.standardItemId
            ? item.standardItemId.price
            : item.price || 0,
        }));

        breakdown.push(
          { description: 'Total Amount (includes VAT)', amount: amountInGBP },
          { description: 'PayPal Transaction ID', amount: transactionId },
        );

        await PaymentHistory.create({
          taskId: task._id,
          firstName: task.firstName,
          lastName: task.lastName,
          phoneNumber: task.phoneNumber,
          amount: amountInGBP * 100,
          paymentType: 'PayPal',
          paymentDate: new Date(),
          transactionId,
          payerAccount,
        });

        // Envoyer l'email de confirmation
        await sendPaymentConfirmationEmail({
          email: task.email,
          firstName: task.firstName,
          lastName: task.lastName,
          orderId: taskId,
          paymentDate: new Date().toLocaleString(),
          amount: amountInGBP,
          currency: 'GBP',
          paymentType: 'PayPal',
          breakdown,
        });

        return res.status(200).json({
          message: 'PayPal payment captured successfully and email sent',
          task,
        });
      } else {
        return res
          .status(400)
          .json({ message: 'Failed to capture payment', capture });
      }
    } catch (error) {
      console.error('Error capturing PayPal payment:', error);
      return res.status(500).json({
        message: 'Failed to capture PayPal payment',
        error: error.message,
      });
    }
  },

  generatePaymentLinks: async (req, res) => {
    const { taskId } = req.params;
    const { paymentType, notes } = req.body; // Accept paymentType
    console.log('paymentType', paymentType);
    try {
      const task = await Task.findById(taskId).populate('items.standardItemId');
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      let amountToPay;
      if (paymentType === 'deposit') {
        let requestedDeposit = task.paidAmount?.amount || 0;

        // Si le user a choisi moins de 36, on impose 36
        amountToPay = Math.max(requestedDeposit, 36);

        task.paidAmount = {
          amount: amountToPay,
          method: 'payment_link',
          status: 'Not_Paid',
        };
        task.remainingAmount = {
          amount: task.totalPrice - amountToPay,
          status: 'Not_Paid',
          method: 'cash',
        };
        // Reflect partial payment intent on the task
        task.paymentStatus = 'partial_Paid';
        await task.save();

      } else if (paymentType === 'remaining') {
        amountToPay = task.remainingAmount?.amount;

        task.remainingAmount = {
          amount: amountToPay,
          status: 'Not_Paid',
          method: 'payment_link'
        }
        task.paymentMethod = 'payment_link';

        await task.save();
      } else {
        amountToPay = task.totalPrice;
        await task.save();
      }
      if (!amountToPay || amountToPay <= 0) {
        return res
          .status(400)
          .json({ message: 'No amount to pay for this payment type.' });
      }

      // Calculate total price and breakdown as before
      let subtotal = 0;
      const breakdown = [];

      // Calculate subtotal with discount handling
      for (const item of task.items) {
        let itemPrice = 0;
        let itemDescription = '';

        if (item.standardItemId) {
          itemPrice = Number(item.standardItemId.price);
          itemDescription = item.standardItemId.itemName;
        } else if (item.object) {
          itemPrice = Number(item.price);
          itemDescription = item.object;
        }

        const quantity = Number(item.quantity) || 1;
        let positionFee = 0;
        if (item.Objectsposition === 'InsideWithDismantling') {
          positionFee = 18;
        } else if (item.Objectsposition === 'Inside') {
          positionFee = 6;
        }

        // Per-item discount logic: use customPrice if present, and always add positionFee
        let displayPrice = itemPrice;
        let finalItemTotal = itemPrice * quantity + positionFee;
        if (
          task.hasDiscount &&
          task.discountType === 'perItem' &&
          item.customPrice
        ) {
          displayPrice = Number(item.customPrice) + positionFee / quantity;
          finalItemTotal = Number(item.customPrice) * quantity + positionFee;
        } else if (positionFee > 0) {
          // If no discount but there is a position fee, add it to the per-unit price for display
          displayPrice = itemPrice + positionFee / quantity;
        }

        breakdown.push({
          itemDescription,
          quantity,
          price: displayPrice,
          positionFee,
          total: finalItemTotal,
          Objectsposition: item.Objectsposition,
        });

        subtotal += finalItemTotal;
      }

      // Handle percentage discount if discountType is "percentage"
      if (
        task.hasDiscount &&
        task.discountType === 'percentage' &&
        task.customDiscountPercent > 0
      ) {
        const percentageDiscount =
          (subtotal * task.customDiscountPercent) / 100;
        subtotal -= percentageDiscount;
        breakdown.push({
          description: `Discount (${task.customDiscountPercent}%)`,
          amount: -percentageDiscount,
        });
      }

      // Enforce minimum price (before VAT)
      if (subtotal < 30) {
        const adjustment = 30 - subtotal;
        subtotal = 30;
        breakdown.push({
          description: 'Minimum price adjustment',
          amount: adjustment,
        });
      }

      // Add VAT
      const vat = subtotal * 0.2;
      const totalPrice = subtotal + vat;

      breakdown.push({
        description: 'VAT (20%)',
        amount: vat,
      });

      validateBreakdown(breakdown);

      // Debug log to confirm amountToPay and paymentType
      console.log(
        'amountToPay for payment link:',
        amountToPay,
        'paymentType:',
        paymentType,
      );
      const orderNumber = task.orderNumber;
      // Generate payment links for the specified amount
      const stripeLink = await createStripePaymentLink(
        taskId,
        amountToPay,
        breakdown,
        paymentType,
        orderNumber,
      );
      const paypalLink = await createPaypalPaymentLink(
        taskId,
        amountToPay,
        breakdown,
        paymentType,
      );

      // Send email with payment links and paymentType
      await sendPayementEmail({
        taskId,
        customerEmail: task.email,
        stripeLink,
        paypalLink,
        totalPrice: amountToPay,
        totall: totalPrice,
        breakdown,
        notes,
        taskDetails: task,
        paymentType,
        amountToPay,
      });

      res.status(200).json({
        message: 'Payment links generated successfully and email sent',
        stripeLink,
        paypalLink,
        totalPrice: amountToPay,
        paymentType,
      });
    } catch (error) {
      console.error('Error generating payment links:', error);
      res.status(500).json({
        message: 'Failed to generate payment links',
        error: error.message,
      });
    }
  },

  // Update payment status logic in the Stripe webhook handler
  handleStripeWebhook: async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        endpointSecret,
      );
      console.log('Webhook verified:', event.type);
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const taskId = session.metadata.taskId;
        const paymentAmountType = session.metadata.paymentAmountType || 'full payment'; // Get payment type from metadata
        if (!taskId) {
          console.error('Task ID missing in session metadata');
          return res.status(400).send('Task ID is required');
        }
        console.log(
          'Stripe webhook received for event:',
          event.type,
          'taskId:',
          taskId,
          'paymentAmountType:',
          paymentAmountType,
        );
        const task = await Task.findById(taskId).populate(
          'items.standardItemId',
        );
        if (!task) {
          console.error(`Task not found for ID: ${taskId}`);
          return res.status(404).send('Task not found');
        }

        // Update payment status based on payment type
        if (paymentAmountType === 'deposit') {
          // Deposit paid: mark deposit as Paid, remaining stays Not_Paid, keep overall task as partial
          task.paidAmount.status = 'Paid';
          task.paidAmount.method = task.paidAmount.method || 'online';
          task.remainingAmount.status = task.remainingAmount.status || 'Not_Paid';
          task.paymentStatus = 'partial_Paid';
          // Do NOT auto-complete task on deposit
        } else {
          // Full payment
          task.paidAmount.status = 'Paid';
          task.remainingAmount.status = 'Paid';
          task.paymentStatus = 'Paid';
          task.taskStatus = 'Completed';
        }
        const amountInCents = session.amount_total;
        const amountInGBP = amountInCents / 100;
        const paymentIntentId = session.payment_intent || session.id;
        const payerAccount = task.email;
        await task.save();
        console.log('Task payment status updated:', {
          taskId,
          paymentAmountType,
          paymentStatus: task.paymentStatus,
          paidAmountStatus: task.paidAmount.status,
          remainingAmountStatus: task.remainingAmount.status,
        });
        await PaymentHistory.create({
          taskId: task._id,
          firstName: task.firstName,
          lastName: task.lastName,
          phoneNumber: task.phoneNumber,
          amount: amountInGBP,
          paymentType: 'Stripe',
          paymentDate: new Date(),
          transactionId: paymentIntentId,
          payerAccount,
        });

        // Envoyer l'email de confirmation
        await sendPaymentConfirmationEmail({
          email: payerAccount,
          firstName: task.firstName,
          lastName: task.lastName,
          orderId: taskId,
          paymentDate: new Date().toLocaleString(),
          amount: amountInGBP,
          currency: 'GBP',
          paymentType: 'Stripe',
          // breakdown,
        });

        res.status(200).send('Webhook received');
      }
    } catch (err) {
      console.error(`Webhook error: ${err.message}`);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  },

  handlePayPalWebhook: async (req, res) => {
    try {
      const evt = req.body;
      console.log('PayPal webhook:', evt.event_type, evt.resource?.id);

      switch (evt.event_type) {
        case 'CHECKOUT.ORDER.APPROVED': {
          const orderId = evt.resource.id;
          const client = PayPalClient();

          // Capture
          const capReq = new paypal.orders.OrdersCaptureRequest(orderId);
          capReq.requestBody({});
          const capRes = await client.execute(capReq);

          if (!(capRes.statusCode === 201 || capRes.result.status === 'COMPLETED')) {
            console.error('Capture failed', capRes.statusCode, capRes.result?.status);
            return res.status(500).send('Capture failed');
          }

          // Get order (for custom_id & payer email)
          const getReq = new paypal.orders.OrdersGetRequest(orderId);
          const getRes = await client.execute(getReq);
          const pu = getRes.result.purchase_units?.[0];
          const customIdRaw = pu?.custom_id; // could be "<taskId>|<paymentType>"
          const [customId, paymentTypeMeta] = (customIdRaw || '').split('|');
          const payerEmail = getRes.result.payer?.email_address;

          if (!customId) return res.status(400).send('Missing custom_id');

          const task = await Task.findById(customId).populate('items.standardItemId');
          if (!task) return res.status(404).send('Task not found');
          // Update based on payment type
          if (paymentTypeMeta === 'deposit') {
            task.paidAmount = task.paidAmount || {};
            task.remainingAmount = task.remainingAmount || {};
            task.paidAmount.status = 'Paid';
            task.paidAmount.method = task.paidAmount.method || 'payment_link';
            task.remainingAmount.status = task.remainingAmount.status || 'Not_Paid';
            task.paymentStatus = 'partial_Paid';
          } else {
            if (task.paymentStatus === 'Paid') return res.status(200).send('Already processed');
            task.paymentStatus = 'Paid';
            task.taskStatus = 'Completed';
            task.paidAmount = task.paidAmount || {};
            task.remainingAmount = task.remainingAmount || {};
            task.paidAmount.status = 'Paid';
            task.remainingAmount.status = 'Paid';
          }
          await task.save();

          const cap = capRes.result.purchase_units[0].payments.captures[0];
          await PaymentHistory.create({
            taskId: task._id,
            firstName: task.firstName,
            lastName: task.lastName,
            phoneNumber: task.phoneNumber,
            amount: Number(cap.amount.value),        // store in GBP consistently
            currency: cap.amount.currency_code,
            paymentType: 'PayPal',
            paymentDate: new Date(cap.create_time),
            transactionId: cap.id,
            payerAccount: payerEmail || `PayPal ${cap.id}`,
          });

          // fire-and-forget the email (don’t block webhook)
          sendPaymentConfirmationEmail({
            email: task.email, firstName: task.firstName, lastName: task.lastName,
            orderId: String(task._id), paymentDate: new Date().toLocaleString(),
            amount: Number(cap.amount.value), currency: cap.amount.currency_code,
            paymentType: 'PayPal', taskDetails: task,
            breakdown: task.items.map(i => ({
              itemDescription: i.standardItemId ? i.standardItemId.itemName : i.object,
              quantity: i.quantity || 1,
              price: i.standardItemId ? i.standardItemId.price : i.price || 0,
            })),
          }).catch(console.error);

          return res.status(200).send('Captured');
        }

        case 'PAYMENT.CAPTURE.COMPLETED': {
          const capture = evt.resource;
          const orderId = capture?.supplementary_data?.related_ids?.order_id;
          if (!orderId) return res.status(400).send('Missing order id on capture');

          const client = PayPalClient();
          const getReq = new paypal.orders.OrdersGetRequest(orderId);
          const getRes = await client.execute(getReq);
          const pu = getRes.result.purchase_units?.[0];
          const customIdRaw = pu?.custom_id;
          const [customId, paymentTypeMeta] = (customIdRaw || '').split('|');
          const payerEmail = getRes.result.payer?.email_address;
          if (!customId) return res.status(400).send('Missing custom_id');

          const task = await Task.findById(customId).populate('items.standardItemId');
          if (!task) return res.status(404).send('Task not found');
          if (paymentTypeMeta === 'deposit') {
            task.paidAmount = task.paidAmount || {};
            task.remainingAmount = task.remainingAmount || {};
            task.paidAmount.status = 'Paid';
            task.paidAmount.method = task.paidAmount.method || 'payment_link';
            task.remainingAmount.status = task.remainingAmount.status || 'Not_Paid';
            task.paymentStatus = 'partial_Paid';
          } else {
            if (task.paymentStatus === 'Paid') return res.status(200).send('Already processed');
            task.paymentStatus = 'Paid';
            task.taskStatus = 'Completed';
            task.paidAmount.status = 'Paid';
            task.remainingAmount.status = 'Paid';
          }
          await task.save();

          const payerAccount =
            capture.payer?.email_address ||
            `PayPal ID: ${capture.payer?.payer_id}`;
          const paymentDate = new Date(capture.create_time);

          // Créer une entrée dans PaymentHistory
          await PaymentHistory.create({
            taskId: task._id,
            firstName: task.firstName,
            lastName: task.lastName,
            phoneNumber: task.phoneNumber,
            amount: Number(capture.amount.value),    // GBP
            currency: capture.amount.currency_code,
            paymentType: 'PayPal',
            paymentDate: new Date(capture.create_time),
            transactionId: capture.id,
            payerAccount: payerEmail || `PayPal ${capture.id}`,
          });

          // (optional) send email async as above…
          return res.status(200).send('Processed');
        }

        default:
          return res.status(200).send('Ignored');
      }
    } catch (err) {
      console.error('PayPal webhook error:', err);
      return res.status(500).send('Webhook processing failed');
    }
  },

  sendBookingConfirmation: async (req, res) => {
    const { taskId } = req.params;

    try {
      const task = await Task.findById(taskId).populate('items.standardItemId');
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      await sendBookingConfirmationEmail(taskId);

      res.status(200).json({
        message: 'Booking confirmation email sent successfully',
        task,
      });
    } catch (error) {
      console.error('Error sending booking confirmation:', error);
      res.status(500).json({
        message: 'Failed to send booking confirmation',
        error: error.message,
      });
    }
  },

  sendInvoice: async (req, res) => {
    const { taskId } = req.params;
    let subtotal = 0;
    let percentageDiscount = 0;
    try {
      const task = await Task.findById(taskId).populate('items.standardItemId');
      // console.log('task', task.items);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      // Ensure directory exists
      const dirPath = path.join(__dirname, '../generated');
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);

      const fileName = `invoice-${task.orderNumber}.pdf`;
      const filePath = path.join(dirPath, fileName);

      // Generate the official invoice PDF
      await generateOfficialInvoicePDF(task, filePath);

      // Email content in branded design
      const paidAmount = task.paidAmount?.amount || 0;
      const remainingAmount = task.totalPrice - paidAmount;
      const isPartialPaid = task.paymentStatus === 'partial_Paid';
      const subtotalBeforeDiscount = task.totalPrice;

      // Calculate subtotal and handle discounts based on discountType
      task.items.forEach((item) => {
        // For custom items, use item.price; for standard items, use standardItemId.price
        const itemPrice = item.standardItemId
          ? item.standardItemId.price * item.quantity || 0
          : item.price * item.quantity || 0;

        const positionPrice =
          item.Objectsposition === 'InsideWithDismantling'
            ? item.standardItemId?.insideWithDismantlingPrice || 0
            : item.Objectsposition === 'Inside'
              ? item.standardItemId?.insidePrice || 0
              : 0;

        const itemSubtotal = itemPrice + positionPrice;

        // Handle item-specific discount only if hasDiscount is true and discountType is "perItem"
        let finalItemTotal = itemSubtotal;
        if (
          task.hasDiscount &&
          task.discountType === 'perItem' &&
          item.customPrice
        ) {
          finalItemTotal = item.customPrice * item.quantity + positionPrice;
        }

        subtotal += finalItemTotal;
        console.log('subtotal', subtotal);
      });

      // Handle percentage discount on total only if hasDiscount is true and discountType is "percentage"
      if (
        task.hasDiscount &&
        task.discountType === 'percentage' &&
        task.customDiscountPercent > 0
      ) {
        percentageDiscount = (subtotal * task.customDiscountPercent) / 100;
      }

      // Apply minimum price (before VAT) - if under £30, make it £30
      if (subtotal < 30) {
        subtotal = 30;
      }

      const discountedSubtotal = subtotal - percentageDiscount;
      const vat = discountedSubtotal * 0.2;
      const total = discountedSubtotal + vat;
      console.log(
        'total',
        total,
        'vat',
        vat,
        'subtotal:',
        subtotal,
        'percentageDiscount',
        percentageDiscount,
      );
      // // Read the template file
      // const templatePath = path.join(
      //   __dirname,
      //   '../public/templates/invoiceConfirmation.html',
      // );
      // let template = fs.readFileSync(templatePath, 'utf8');

      // // Replace template variables
      // template = template.replace('{{firstName}}', task.firstName);
      // template = template.replace('{{lastName}}', task.lastName);
      // template = template.replace('{{orderNumber}}', task.orderNumber);
      // template = template.replace('{{totalPrice}}', task.totalPrice.toFixed(2));

      // // Handle conditional content for partial payment
      // if (isPartialPaid) {
      //   const paymentDetails = `
      //     <p>Payment Details:</p>
      //     <ul>
      //       ${
      //         discountAmount > 0
      //           ? `<li>Discount (${
      //               task.customDiscountPercent
      //             }%): -£${discountAmount.toFixed(2)}</li>`
      //           : ''
      //       }
      //       <li>VAT (20%): £${vat.toFixed(2)}</li>
      //       <li>Total Amount (Including VAT): £${total.toFixed(2)}</li>
      //     </ul>
      //     <p>Please settle the remaining balance at your earliest convenience.</p>`;

      //   template = template.replace('{{#if isPartialPaid}}', '');
      //   template = template.replace('{{/if}}', '');
      //   template = template.replace('{{#if hasDiscount}}', '');
      //   template = template.replace('{{/if}}', '');
      //   template = template.replace(
      //     '{{customDiscountPercent}}',
      //     task.customDiscountPercent,
      //   );
      //   template = template.replace(
      //     '{{discountAmount}}',
      //     discountAmount.toFixed(2),
      //   );
      //   template = template.replace('{{vat}}', vat.toFixed(2));
      //   template = template.replace('{{total}}', total.toFixed(2));

      //   // Replace the conditional blocks with actual content
      //   template = template.replace(
      //     /{{#if isPartialPaid}}[\s\S]*?{{else}}[\s\S]*?{{\/if}}/g,
      //     paymentDetails,
      //   );
      // } else {
      //   // Remove conditional blocks for non-partial payment
      //   template = template.replace(
      //     /{{#if isPartialPaid}}[\s\S]*?{{else}}([\s\S]*?){{\/if}}/g,
      //     '$1',
      //   );
      //   template = template.replace(/{{#if hasDiscount}}[\s\S]*?{{\/if}}/g, '');
      // }
      const templatePath = path.join(
        __dirname,
        '../public/templates/invoiceConfirmation.html',
      );
      const templateSource = fs.readFileSync(templatePath, 'utf8');
      const template = Handlebars.compile(templateSource);

      const emailContent = template({
        firstName: task.firstName,
        lastName: task.lastName,
        orderNumber: task.orderNumber,
        totalPrice: total.toFixed(2),
        hasDiscount: task.customDiscountPercent > 0,
        customDiscountPercent: task.customDiscountPercent,
        discountAmount: percentageDiscount.toFixed(2),
        vat: vat.toFixed(2),
        total: total.toFixed(2),
        isPartialPaid: isPartialPaid,
        remainingAmount: remainingAmount.toFixed(2),
      });
      // Send the email with the generated PDF as attachment
      await transporter.sendMail({
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: task.email,
        subject: `Invoice for Order #${task.orderNumber}`,
        html: emailContent,
        attachments: [{ filename: fileName, path: filePath }],
      });

      // Clean up
      fs.unlinkSync(filePath);

      res.status(200).json({
        message: 'Invoice sent successfully',
        task,
      });
    } catch (error) {
      console.error('Error sending invoice:', error);
      res.status(500).json({
        message: 'Failed to send invoice',
        error: error.message,
      });
    }
  },
  // Lock a task
  lockTask: async (req, res) => {
    const { taskId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    try {
      // Check if task exists
      const task = await Task.findById(taskId);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      // Check if task is already locked
      const existingLock = await OrderLock.findOne({ taskId });
      if (existingLock) {
        if (existingLock.lockedBy === userId) {
          // If locked by same user, extend the lock
          existingLock.expiresAt = new Date(Date.now() + LOCK_DURATION);
          await existingLock.save();
          return res.json({
            message: 'Lock extended',
            isLocked: true,
            lockedBy: existingLock.lockedBy,
          });
        } else {
          // If locked by different user, return lock info
          return res.status(409).json({
            message: 'Task is already locked by another user',
            isLocked: true,
            lockedBy: existingLock.lockedBy,
          });
        }
      }

      // Create new lock
      const lock = await OrderLock.create({
        taskId,
        lockedBy: userId,
        expiresAt: new Date(Date.now() + LOCK_DURATION),
      });

      res.json({
        message: 'Task locked successfully',
        isLocked: true,
        lockedBy: lock.lockedBy,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to lock task',
        error: error.message,
      });
    }
  },

  // Unlock a task
  unlockTask: async (req, res) => {
    const { taskId } = req.params;
    const userId = req.user?._id;
    console.log('unlock by ', userId);
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
      console.log('user not authenticated');
    }

    try {
      const lock = await OrderLock.findOne({ taskId }).populate('lockedBy');

      if (!lock) {
        console.log('task is not locked');
        return res.json({
          message: 'Task is not locked',
          isLocked: false,
          lockedBy: null,
        });
      }

      // Only allow the user who locked it to unlock it
      if (!lock.lockedBy._id.equals(userId)) {
        console.log('lock.lockedBy', lock.lockedBy._id);
        console.log('userId', userId);
        console.log('user does not have permission to unlock the task');
        return res.status(403).json({
          message: 'You do not have permission to unlock this task',
          isLocked: true,
          lockedBy: lock.lockedBy,
        });
      }

      await lock.deleteOne();
      console.log('task unlocked successfully');
      res.json({
        message: 'Task unlocked successfully',
        isLocked: false,
        lockedBy: null,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to unlock task',
        error: error.message,
      });
    }
  },

  // Get lock status
  getTaskLockStatus: async (req, res) => {
    const { taskId } = req.params;

    try {
      const lock = await OrderLock.findOne({ taskId }).populate('lockedBy');

      if (!lock) {
        return res.json({
          isLocked: false,
          lockedBy: null,
        });
      }

      // Check if lock has expired
      if (lock.expiresAt < new Date()) {
        await lock.deleteOne();
        return res.json({
          isLocked: false,
          lockedBy: null,
        });
      }

      res.json({
        isLocked: true,
        lockedBy: lock.lockedBy,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to get lock status',
        error: error.message,
      });
    }
  },

  sendWasteTransferNote: async (req, res) => {
    const { taskId } = req.params;
    try {
      await sendWasteTransferNoteEmail(taskId);
      res
        .status(200)
        .json({ message: 'Waste Transfer Note sent successfully' });
    } catch (error) {
      console.error('Error sending waste transfer note:', error);
      res.status(500).json({
        message: 'Failed to send waste transfer note',
        error: error.message,
      });
    }
  },
};

module.exports = taskCtrl;