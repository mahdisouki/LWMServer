const BlockingDays = require('../models/BlockingDays');
const Task = require('../models/Task');
const Truck = require('../models/Truck');
const paypal = require('@paypal/checkout-server-sdk');
const mongoose = require('mongoose');
const { emitNotificationToUser } = require('../socket.js')
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
const {generateOfficialInvoicePDF} = require('../services/emailsService');
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});
const loggingService = require('../services/loggingService');

function validateBreakdown(breakdown) {
  if (!Array.isArray(breakdown) || breakdown.some(item => {
    return isNaN(parseFloat(item.price)) && isNaN(parseFloat(item.amount));
  })) {
    console.error("Invalid breakdown: ", breakdown);
    throw new Error("Breakdown is not valid or contains undefined prices or descriptions");
  }
}
// Fonction auxiliaire pour traiter les événements de commande approuvés
async function calculateTotalPrice({ standardItems = [], objects = [], customDiscountPercent }) {
  let totalPrice = 0;

  // 1. Add custom items (objects) - NO position fee
  if (objects && Array.isArray(objects)) {
    objects.forEach((customObject) => {
      if (customObject.object && customObject.price) {
        const itemTotal = Number(customObject.price) * (Number(customObject.quantity) || 1);
        totalPrice += itemTotal;
      }
    });
  }

  // 2. Add standard items (with per-item custom price if present) + position fee
  if (standardItems && Array.isArray(standardItems)) {
    for (const item of standardItems) {
      if(!item.standardItemId) continue;
      const standardItem = await StandardItem.findById(item.standardItemId);
      if (!standardItem) continue;

      // Use customPrice if present, otherwise use standard price
      let price = (typeof item.customPrice !== 'undefined' && !isNaN(Number(item.customPrice)))
        ? Number(item.customPrice)
        : Number(standardItem.price);

      // Always add position fee for standard items
      if (item.Objectsposition === "InsideWithDismantling") price += 18;
      else if (item.Objectsposition === "Inside") price += 6;

      const itemTotal = price * (Number(item.quantity) || 1);
      totalPrice += itemTotal;
    }
  }

  // 3. Apply global discount if present (before VAT)
  if (typeof customDiscountPercent !== 'undefined' && !isNaN(customDiscountPercent) && customDiscountPercent > 0) {
    totalPrice = totalPrice * (1 - customDiscountPercent / 100);
  }

  // 4. Enforce minimum price (before VAT)
  if (totalPrice < 30) totalPrice = 30;

  // 5. Add VAT (20%)
  const vat = totalPrice * 0.2;
  totalPrice += vat;

  return {
    totalPrice: Number(totalPrice.toFixed(2)),
    vat: Number(vat.toFixed(2))
  };
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
        objects, // Custom items
        standardItems, // Standard items with quantity, position, and maybe customPrice
        paymentStatus,
        cloneClientObjectPhotos,
        postcode,
        customDiscountPercent // NEW: from frontend
      } = req.body;
  
      let clientObjectPhotos = [];
      if (cloneClientObjectPhotos) {
        clientObjectPhotos = cloneClientObjectPhotos;
      } else if (req.files && req.files.length > 0) {
        clientObjectPhotos = req.files.map((file) => file.path);
      }
  
      const taskDate = new Date(date);
  
      // ... (blocking day and truck checks as before) ...
  
      // Calculate price using new logic
      const { totalPrice, vat } = await calculateTotalPrice({
        standardItems,
        objects,
        customDiscountPercent
      });
  
      // Prepare items array for DB (merge standard and custom)
      let items = [];
      if (standardItems && Array.isArray(standardItems)) {
        items.push(...standardItems.map(item => ({
          standardItemId: item.standardItemId || null,
          quantity: Number(item.quantity) || 1,
          Objectsposition: item.Objectsposition || "Outside",
          customPrice: item.customPrice !== undefined ? Number(item.customPrice) : undefined
        })));
      }
      if (objects && Array.isArray(objects)) {
        items.push(...objects.map(item => ({
          object: item.object || null,
          quantity: Number(item.quantity) || 1,
          price: Number(item.price) || 0,
          Objectsposition: item.Objectsposition || "Outside"
        })));
      }
  
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
        clientObjectPhotos,
        totalPrice,
        items,
        taskStatus: 'Processing',
        postcode,
        customDiscountPercent // Save for reference
      });
  
      await newTask.save();
      // ... (emit notification, etc.) ...
      res.status(201).json({
        message: 'Task created successfully',
        task: newTask,
      });
    } catch (error) {
      console.log(error)
      res.status(400).json({ message: 'Failed to create task', error: error.message });
    }
  },

  getTaskById: async (req, res) => {
    const { taskId } = req.params;

    try {
      const task = await Task.findById(taskId).populate('createdBy', 'email name'); // optional fields;
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
        ['firstName', 'lastName', 'email', 'username', 'phoneNumber', 'postcode', 'orderNumber'] // searchable fields
      );

      const tasksWithTrucks = await Promise.all(
        tasks.map(async (task) => {
          if (task.truckId) {
            const truck = await Truck.findById(task.truckId);
            task = task.toObject();
            task.truckName = truck?.name ?? null;
          }
          return task;
        })
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
            (id) => id !== task._id.toString()
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
      const newTasksByDate = newTruck.tasks ? Object.fromEntries(newTruck.tasks) : {};
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
        !['Declined', 'Processing', 'Completed', 'Cancelled', 'On_Hold' , 'Not_Completed',"Completed" ].includes(taskStatus)
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
      console.log(req.body)
      const oldTask = await Task.findById(taskId);
      console.log('hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh')
      if (!oldTask) {
        return res.status(404).json({ message: 'Task not found' });
      }

      // If items are being updated, recalculate totalPrice
      if (updates.items) {
        // Save the new items first
        await Task.findByIdAndUpdate(taskId, { $set: { items: updates.items } });
        // Re-fetch the task with populated items
        const populatedTask = await Task.findById(taskId).populate('items.standardItemId');
        let totalPrice = 0;
        for (const item of populatedTask.items) {
          let price = 0;
          if (item.standardItemId && item.standardItemId.price) {
            price = Number(item.standardItemId.price);
          } else if (item.price) {
            price = Number(item.price);
          }
          const quantity = Number(item.quantity) || 1;
          let positionFee = 0;
          if (item.Objectsposition === "InsideWithDismantling") positionFee = 18;
          else if (item.Objectsposition === "Inside") positionFee = 6;
          const itemTotal = (price * quantity) + positionFee;
          console.log('Item:', item, 'Price:', price, 'Quantity:', quantity, 'PositionFee:', positionFee, 'ItemTotal:', itemTotal);
          totalPrice += itemTotal;
        }
        // Add VAT
        const vat = totalPrice * 0.2;
        totalPrice += vat;
        console.log('Calculated totalPrice with VAT:', totalPrice);
        updates.totalPrice = totalPrice;
      }
      console.log(updates.totalPrice)     // Update the task
      const updatedTask = await Task.findByIdAndUpdate(
        taskId,
        { $set: updates },
        { new: true }
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
          after: updatedTask.toObject()
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      res.status(200).json({
        message: 'Task updated successfully',
        task: updatedTask
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update task',
        error: error.message
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
        await task.save();
        return res.status(200).json({
          message: 'Task marked as started successfully',
          task,
        });
      }

      if (action === 'mark_finish') {
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
      const task = await Task.findById(taskId).populate("items.standardItemId");
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }
  
      // Build breakdown array
      const selectedQuantities = {};
      task.items.forEach((item) => {
        if (item.standardItemId) {
          selectedQuantities[item.standardItemId._id.toString()] = item.quantity || 1;
        }
      });
  
      const breakdown = task.items.map((item) => {
        const itemQuantity = selectedQuantities[item.standardItemId?._id?.toString()] || item.quantity || 1;
        const itemPrice = item.standardItemId ? item.standardItemId.price : item.price || 0;
        return {
          itemDescription: item.standardItemId ? item.standardItemId.itemName : item.object,
          quantity: itemQuantity,
          price: itemPrice,
          Objectsposition: item.Objectsposition,
        };
      });
  
      let basePrice = breakdown.reduce((sum, item) => sum + item.price * item.quantity, 0);
      let additionalFees = 0;
      task.items.forEach((item) => {
        if (item.Objectsposition === "InsideWithDismantling") additionalFees += 18;
        else if (item.Objectsposition === "Inside") additionalFees += 6;
      });
      let finalPrice = basePrice + additionalFees;
      if (task.available === "AnyTime" && task.items.every((i) => i.Objectsposition === "Outside")) {
        finalPrice *= 0.9;
      }
      if (finalPrice < 30) finalPrice = 30;
      const vat = finalPrice * 0.2;
      finalPrice += vat;
  
      // Prepare fullBreakdown for PayPal
      const fullBreakdown = [
        ...breakdown,
        { description: "VAT (20%)", amount: vat.toFixed(2) },
        { description: "Final Total Price", amount: finalPrice.toFixed(2) },
      ];
  
      // --- NEW: Determine amount to pay based on paymentAmountType ---
      let amountToPay;
      if (paymentAmountType === 'deposit') {
        task.paymentStatus = "partial_Paid";
        amountToPay = 36; // Set deposit amount
        task.paidAmount = {
          amount: 36,
          method: "online",
          status: "Not_Paid" // Will be updated to Paid after successful payment
        };
        task.remainingAmount = {
          amount: finalPrice - 36,
          method: "online",
          status: "Not_Paid"
        };
      } else {
        amountToPay = finalPrice; // Set full amount
        task.paidAmount = {
          amount: finalPrice,
          method: "online",
          status: "Not_Paid" // Will be updated to Paid after successful payment
        };
        task.remainingAmount = {
          amount: 0,
          method: "online",
          status: "Not_Paid"
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
              payment_method_types: ['card', 'paypal'],
              mode: 'payment',
              line_items: [
                {
                  price_data: {
                    currency: 'GBP',
                    product_data: {
                      name: `Payment for Task ${taskId}`,
                      images: ["https://res.cloudinary.com/dfxeaeebv/image/upload/v1742959873/slpany1oqx09lxj72nmd.png"],
                    },
                    unit_amount: amountInPence,
                  },
                  quantity: 1,
                },
              ],
              success_url: `${process.env.CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `${process.env.CLIENT_URL}/payment-cancel`,
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
          paymentResult = await createPayPalOrder(amountInPence, taskId, fullBreakdown, task);
          return res.json({
            message: 'PayPal payment initiated successfully',
            orderID: paymentResult.result.id,
            approvalLink: paymentResult.result.links.find((link) => link.rel === 'approve')?.href || null,
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
      return res.status(500).json({ message: 'Failed to initiate payment', error: error.message });
    }
  },

  confirmStripeTaskPayment: async (req, res) => {
    const { paymentIntentId, paymentMethodId, taskId } = req.body;

    try {
      // Confirmer le paiement Stripe
      const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
        payment_method: paymentMethodId,
      });

      if (paymentIntent.status === 'succeeded') {
        const task = await Task.findById(taskId).populate('items.standardItemId');
        if (!task) return res.status(404).json({ message: 'Task not found' });

        task.paymentStatus = 'Paid';
        await task.save();

        // Montant en GBP
        const amountInCents = paymentIntent.amount;
        const amountInGBP = Number((amountInCents / 100).toFixed(2));

        // Récupérer les informations du paiement
        const charges = await stripe.charges.list({ payment_intent: paymentIntentId, limit: 1 });
        const charge = charges.data[0];
        if (!charge) throw new Error('Charge not found for this payment');

        const payerAccount = charge.billing_details.email || `Card ending in ${charge.payment_method_details.card.last4}`;

        // Construire le breakdown complet
        const breakdown = task.items.map((item) => ({
          itemDescription: item.standardItemId ? item.standardItemId.itemName : 'Custom Item',
          quantity: item.quantity || 1,
          price: item.standardItemId ? item.standardItemId.price : item.price || 0,
        }));

        // Ajouter le total et les détails de la méthode de paiement
        breakdown.push(
          { description: 'Total Amount (includes VAT)', amount: amountInGBP },
          { description: 'Payment Method', amount: payerAccount }
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

        return res.status(200).json({ message: 'Payment confirmed successfully and email sent', task });
      } else {
        return res.status(400).json({ message: 'Payment confirmation failed', status: paymentIntent.status });
      }
    } catch (error) {
      console.error('Error confirming payment:', error);
      return res.status(500).json({ message: 'Error confirming payment', error: error.message });
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
        await task.save();

        const amountInGBP = parseFloat(capture.result.purchase_units[0].payments.captures[0].amount.value);
        const transactionId = capture.result.purchase_units[0].payments.captures[0].id;
        const payerAccount = capture.result.payer.email_address;

        // Construire le breakdown complet
        const breakdown = task.items.map((item) => ({
          itemDescription: item.standardItemId ? item.standardItemId.itemName : 'Custom Item',
          quantity: item.quantity || 1,
          price: item.standardItemId ? item.standardItemId.price : item.price || 0,
        }));

        breakdown.push(
          { description: 'Total Amount (includes VAT)', amount: amountInGBP },
          { description: 'PayPal Transaction ID', amount: transactionId }
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

        return res.status(200).json({ message: 'PayPal payment captured successfully and email sent', task });
      } else {
        return res.status(400).json({ message: 'Failed to capture payment', capture });
      }
    } catch (error) {
      console.error('Error capturing PayPal payment:', error);
      return res.status(500).json({ message: 'Failed to capture PayPal payment', error: error.message });
    }
  },

  generatePaymentLinks: async (req, res) => {
    const { taskId } = req.params;
    const { paymentType, notes } = req.body; // Accept paymentType
    console.log("paymentType", paymentType)
    try {
      const task = await Task.findById(taskId).populate('items.standardItemId');
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      let amountToPay;
      if (paymentType === 'deposit') {
        amountToPay = task.paidAmount?.amount;
      } else if (paymentType === 'remaining') {
        amountToPay = task.remainingAmount?.amount;
      } else {
        amountToPay = task.totalPrice;
      }
      if (!amountToPay || amountToPay <= 0) {
        return res.status(400).json({ message: 'No amount to pay for this payment type.' });
      }

      // Calculate total price and breakdown as before
      let totalPrice = 0;
      const breakdown = [];
      for (const item of task.items) {
        let itemPrice = 0;
        let itemDescription = '';
        if (item.standardItemId) {
          itemPrice = item.customPrice || item.standardItemId.price;
          itemDescription = item.standardItemId.itemName;
        } else if (item.object) {
          itemPrice = item.price;
          itemDescription = item.object;
        }
        const quantity = item.quantity || 1;
        const itemTotal = itemPrice * quantity;
        let positionFee = 0;
        if (item.Objectsposition === "InsideWithDismantling") {
          positionFee = 18;
        } else if (item.Objectsposition === "Inside") {
          positionFee = 6;
        }
        const positionFeeTotal = positionFee * quantity;
        const itemTotalWithFee = itemTotal + positionFeeTotal;
        breakdown.push({
          itemDescription,
          quantity,
          price: itemPrice,
          positionFee,
          total: itemTotalWithFee,
          Objectsposition: item.Objectsposition
        });
        totalPrice += itemTotalWithFee;
      }
      if (task.customDiscountPercent > 0) {
        const discountAmount = totalPrice * (task.customDiscountPercent / 100);
        totalPrice -= discountAmount;
        breakdown.push({
          description: `Discount (${task.customDiscountPercent}%)`,
          amount: -discountAmount
        });
      }
      if (totalPrice < 30) {
        const adjustment = 30 - totalPrice;
        totalPrice = 30;
        breakdown.push({
          description: "Minimum price adjustment",
          amount: adjustment
        });
      }
      const vat = totalPrice * 0.2;
      totalPrice += vat;
      breakdown.push({
        description: "VAT (20%)",
        amount: vat
      });
      validateBreakdown(breakdown);

      // Generate payment links for the specified amount
      const stripeLink = await createStripePaymentLink(taskId, amountToPay, breakdown, paymentType);
      const paypalLink = await createPaypalPaymentLink(taskId, amountToPay, breakdown, paymentType);

      // Send email with payment links and paymentType
      await sendPayementEmail({
        taskId,
        customerEmail: task.email,
        stripeLink,
        paypalLink,
        totalPrice: amountToPay,
        totall:totalPrice,
        breakdown,
        notes,
        taskDetails: task,
        paymentType,
        amountToPay
      });

      res.status(200).json({
        message: 'Payment links generated successfully and email sent',
        stripeLink,
        paypalLink,
        totalPrice: amountToPay,
        paymentType
      });
    } catch (error) {
      console.error('Error generating payment links:', error);
      res.status(500).json({ message: 'Failed to generate payment links', error: error.message });
    }
  },

  // Update payment status logic in the Stripe webhook handler
  handleStripeWebhook: async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    try {
      const event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
      console.log("Webhook verified:", event.type);
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const taskId = session.metadata.taskId;
        const paymentAmountType = session.metadata.paymentAmountType; // Get payment type from metadata
        if (!taskId) {
          console.error("Task ID missing in session metadata");
          return res.status(400).send("Task ID is required");
        }
        console.log('Stripe webhook received for event:', event.type, 'taskId:', taskId, 'paymentAmountType:', paymentAmountType);
        const task = await Task.findById(taskId).populate("items.standardItemId");
        if (!task) {
          console.error(`Task not found for ID: ${taskId}`);
          return res.status(404).send("Task not found");
        }

        // Update payment status based on payment type
        if (paymentAmountType === 'deposit') {
          task.paidAmount.status = 'Paid';
          task.paymentStatus = 'partial_Paid';
        } else {
          // Full payment
          task.paidAmount.status = 'Paid';
          task.remainingAmount.status = 'Paid';
          task.paymentStatus = 'Paid';
        }

        await task.save();
        console.log('Task payment status updated:', {
          taskId,
          paymentAmountType,
          paymentStatus: task.paymentStatus,
          paidAmountStatus: task.paidAmount.status,
          remainingAmountStatus: task.remainingAmount.status
        });
        res.status(200).send("Webhook received");
      }
    } catch (err) {
      console.error(`Webhook error: ${err.message}`);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  },

  handlePayPalWebhook: async (req, res) => {
    try {
      const event = req.body;
      console.log("Received PayPal Webhook Event:", JSON.stringify(event));

      switch (event.event_type) {
        case "CHECKOUT.ORDER.APPROVED":
          console.log("Order approved. Capturing payment...");

          const orderId = event.resource.id; // PayPal Order ID
          const customId = event.resource.purchase_units[0]?.custom_id; // Custom Task ID

          if (!customId) {
            console.error("custom_id (Task ID) is missing in the webhook event.");
            return res.status(400).send("Task ID is required in the webhook event");
          }

          try {
            // Capture the payment
            const captureRequest = new paypal.orders.OrdersCaptureRequest(orderId);
            const paypalClient = new paypal.core.PayPalHttpClient(
              new paypal.core.SandboxEnvironment(
                process.env.PAYPAL_CLIENT_ID,
                process.env.PAYPAL_CLIENT_SECRET
              )
            );
            const captureResponse = await paypalClient.execute(captureRequest);

            if (captureResponse.statusCode === 201 || captureResponse.result.status === "COMPLETED") {
              console.log("Payment captured successfully:", captureResponse.result);

              const captureDetail = captureResponse.result.purchase_units[0].payments.captures[0];

              // Trouver la tâche associée
              const task = await Task.findById(customId).populate("items.standardItemId");
              if (!task) {
                console.error(`Task not found for ID: ${customId}`);
                return res.status(404).send("Task not found");
              }

              // Vérifier si la tâche est déjà payée
              if (task.paymentStatus === "Paid") {
                console.log(`Payment already processed for Task ID: ${customId}`);
                return res.status(200).send("Payment already processed");
              }

              // Construire le breakdown des items
              const breakdown = task.items.map((item) => ({
                itemDescription: item.standardItemId ? item.standardItemId.itemName : item.object,
                quantity: item.quantity || 1,
                price: item.standardItemId ? item.standardItemId.price : item.price || 0,
                Objectsposition: item.Objectsposition,
              }));

              // Mettre à jour le statut de paiement de la tâche
              task.paymentStatus = "Paid";
              await task.save();

              const payerAccount =
                captureDetail.payer?.email_address || `PayPal ID: ${captureDetail.payer?.payer_id}`;
              const paymentDate = new Date(captureDetail.create_time);

              // Créer une entrée dans PaymentHistory
              await PaymentHistory.create({
                taskId: task._id,
                firstName: task.firstName,
                lastName: task.lastName,
                phoneNumber: task.phoneNumber,
                amount: parseFloat(captureDetail.amount.value),
                currency: captureDetail.amount.currency_code,
                paymentType: "PayPal",
                paymentDate,
                transactionId: captureDetail.id,
                payerAccount,
                breakdown,
              });

              // Envoyer l'email de confirmation
              await sendPaymentConfirmationEmail({
                email: task.email,
                firstName: task.firstName,
                lastName: task.lastName,
                orderId: customId,
                paymentDate: paymentDate.toLocaleString(),
                amount: parseFloat(captureDetail.amount.value),
                currency: captureDetail.amount.currency_code,
                paymentType: "PayPal",
                taskDetails: task,
                breakdown,
              });

              console.log(`Payment for Task ${customId} confirmed and email sent.`);
              res.status(200).send("Payment captured and processed successfully");
            } else {
              console.error("Failed to capture payment:", captureResponse);
              res.status(500).send("Failed to capture payment");
            }
          } catch (captureError) {
            console.error("Error capturing payment:", captureError);
            res.status(500).send("Error capturing payment");
          }
          break;

        case "PAYMENT.CAPTURE.COMPLETED":
          console.log("Processing completed payment...");
          const captureDetail = event.resource;

          if (!captureDetail.custom_id) {
            console.error("custom_id (Task ID) is missing in the webhook event.");
            return res.status(400).send("Task ID is required in the webhook event");
          }

          const taskId = captureDetail.custom_id;

          // Trouver la tâche associée
          const task = await Task.findById(taskId).populate("items.standardItemId");
          if (!task) {
            console.error(`Task not found for ID: ${taskId}`);
            return res.status(404).send("Task not found");
          }

          // Vérifier si la tâche est déjà payée
          if (task.paymentStatus === "Paid") {
            console.log(`Payment already processed for Task ID: ${taskId}`);
            return res.status(200).send("Payment already processed");
          }

          // Construire le breakdown des items
          const breakdown = task.items.map((item) => ({
            itemDescription: item.standardItemId ? item.standardItemId.itemName : item.object,
            quantity: item.quantity || 1,
            price: item.standardItemId ? item.standardItemId.price : item.price || 0,
            Objectsposition: item.Objectsposition,
          }));

          // Mettre à jour le statut de paiement de la tâche
          task.paymentStatus = "Paid";
          await task.save();

          const payerAccount =
            captureDetail.payer?.email_address || `PayPal ID: ${captureDetail.payer?.payer_id}`;
          const paymentDate = new Date(captureDetail.create_time);

          // Créer une entrée dans PaymentHistory
          await PaymentHistory.create({
            taskId: task._id,
            firstName: task.firstName,
            lastName: task.lastName,
            phoneNumber: task.phoneNumber,
            amount: parseFloat(captureDetail.amount.value),
            currency: captureDetail.amount.currency_code,
            paymentType: "PayPal",
            paymentDate,
            transactionId: captureDetail.id,
            payerAccount,
            breakdown,
          });

          // Envoyer l'email de confirmation
          await sendPaymentConfirmationEmail({
            email: task.email,
            firstName: task.firstName,
            lastName: task.lastName,
            orderId: taskId,
            paymentDate: paymentDate.toLocaleString(),
            amount: parseFloat(captureDetail.amount.value),
            currency: captureDetail.amount.currency_code,
            paymentType: "PayPal",
            taskDetails: task,
            breakdown,
          });

          console.log(`Payment for Task ${taskId} confirmed and email sent.`);
          res.status(200).send("Payment processed successfully");
          break;

        default:
          console.log(`Ignoring event type: ${event.event_type}`);
          res.status(200).send("Event type ignored");
      }
    } catch (error) {
      console.error("Error processing PayPal webhook:", error);
      res.status(500).send(`Webhook processing failed: ${error.message}`);
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
        task
      });
    } catch (error) {
      console.error('Error sending booking confirmation:', error);
      res.status(500).json({
        message: 'Failed to send booking confirmation',
        error: error.message
      });
    }
  }, 

  sendInvoice: async (req, res) => {
    const { taskId } = req.params;
  
    try {
      const task = await Task.findById(taskId).populate('items.standardItemId');
      console.log("task", task.items)
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }
  
      // Ensure directory exists
      const dirPath = path.join(__dirname, "../generated");
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
  
      const fileName = `invoice-${task.orderNumber}.pdf`;
      const filePath = path.join(dirPath, fileName);
  
      // Generate the official invoice PDF
      await generateOfficialInvoicePDF(task, filePath);
  
      // Email content in branded design
      const paidAmount = task.paidAmount?.amount || 0;
      const remainingAmount = task.totalPrice - paidAmount;
      const isPartialPaid = task.paymentStatus === 'partial_Paid';
      const subtotalBeforeDiscount = task.totalPrice ;
      const discountAmount = task.customDiscountPercent > 0
      ? subtotalBeforeDiscount * (task.customDiscountPercent / 100)
      : 0;
      const subtotal = subtotalBeforeDiscount - discountAmount;
    const vat = subtotal * 0.2;
    const total = subtotal + vat;
      const emailContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742959873/slpany1oqx09lxj72nmd.png" width="150" alt="London Waste Management"/>
          </div>
  
          <div style="background-color: #8dc044; color: white; padding: 10px; text-align: center; border-radius: 4px;">
            <h2 style="margin: 0;">Invoice Confirmation</h2>
          </div>
  
          <div style="padding: 20px;">
            <p>Dear ${task.firstName} ${task.lastName},</p>
            <p>Thank you for choosing London Waste Management.</p>
            <p>Please find attached your invoice for Order <strong>#${task.orderNumber}</strong>.</p>
            
            ${isPartialPaid
              ? `<p>Payment Details:</p>
                 <ul>
                    <li>Total Amount (Before VAT): £${(subtotal + discountAmount).toFixed(2)}</li>
                    ${discountAmount > 0 ? `<li>Discount (${task.customDiscountPercent}%): -£${discountAmount.toFixed(2)}</li>` : ''}
                    <li>VAT (20%): £${vat.toFixed(2)}</li>
                    <li>Total Amount (Including VAT): £${total.toFixed(2)}</li>
                 </ul>
                 <p>Please settle the remaining balance at your earliest convenience.</p>`
              : `<p>Total Amount: £${task.totalPrice.toFixed(2)}</p>`
            }
  
            <p>Kind regards,</p>
            <p>London Waste Management</p>
          </div>
  
          <footer style="text-align: center; font-size: 12px; color: #888;">
            <p>London Waste Management | hello@londonwastemanagement.com | 02030971517</p>
          </footer>
        </div>
      `;
  
      // Send the email with the generated PDF as attachment
      await transporter.sendMail({
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: task.email,
        subject: `Invoice for Order #${task.orderNumber}`,
        html: emailContent,
        attachments: [{ filename: fileName, path: filePath }]
      });
  
      // Clean up
      fs.unlinkSync(filePath);
  
      res.status(200).json({
        message: 'Invoice sent successfully',
        task
      });
  
    } catch (error) {
      console.error('Error sending invoice:', error);
      res.status(500).json({
        message: 'Failed to send invoice',
        error: error.message
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
            lockedBy: existingLock.lockedBy
          });
        } else {
          // If locked by different user, return lock info
          return res.status(409).json({
            message: 'Task is already locked by another user',
            isLocked: true,
            lockedBy: existingLock.lockedBy
          });
        }
      }

      // Create new lock
      const lock = await OrderLock.create({
        taskId,
        lockedBy: userId,
        expiresAt: new Date(Date.now() + LOCK_DURATION)
      });

      res.json({
        message: 'Task locked successfully',
        isLocked: true,
        lockedBy: lock.lockedBy
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to lock task',
        error: error.message
      });
    }
  },

  // Unlock a task
  unlockTask: async (req, res) => {
    const { taskId } = req.params;
    const userId = req.user?._id;
    console.log("unlock by ", userId)
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
      console.log("user not authenticated")
    }

    try {
      const lock = await OrderLock.findOne({ taskId }).populate('lockedBy');
      
      if (!lock) {
        console.log("task is not locked")
        return res.json({
          message: 'Task is not locked',
          isLocked: false,
          lockedBy: null
        });
      }

      // Only allow the user who locked it to unlock it
      if (!lock.lockedBy._id.equals(userId)) {
        console.log("lock.lockedBy", lock.lockedBy._id)
        console.log("userId", userId)
        console.log("user does not have permission to unlock the task")
        return res.status(403).json({
          message: 'You do not have permission to unlock this task',
          isLocked: true,
          lockedBy: lock.lockedBy
        });
      }

      await lock.deleteOne();
      console.log("task unlocked successfully")
      res.json({
        message: 'Task unlocked successfully',
        isLocked: false,
        lockedBy: null
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to unlock task',
        error: error.message
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
          lockedBy: null
        });
      }

      // Check if lock has expired
      if (lock.expiresAt < new Date()) {
        await lock.deleteOne();
        return res.json({
          isLocked: false,
          lockedBy: null
        });
      }

      res.json({
        isLocked: true,
        lockedBy: lock.lockedBy
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to get lock status',
        error: error.message
      });
    }
  },
  
};

module.exports = taskCtrl;