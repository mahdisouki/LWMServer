const BlockingDays = require('../models/BlockingDays');
const Task = require('../models/Task');
const Truck = require('../models/Truck');
const APIfeatures = require('../utils/APIFeatures');
const paypal = require('@paypal/checkout-server-sdk');
const mongoose = require('mongoose');
const {
  getPayPalOrderDetails,
  capturePayPalPayment,
  createPaypalPaymentLink,
  createStripePaymentLink,
  calculateTotalPrice,
  createStripePaymentIntent,
  createPayPalOrder,
  PayPalClient,
} = require('../services/paymentService.js');
const PaymentHistory = require('../models/PaymentHistory.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const sendPayementEmail = require('../utils/sendPayementEmail');
const sendPaymentConfirmationEmail = require('../utils/sendPayementRecivedEmail');
const StandardItem = require('../models/StandardItem'); // Ajustez le chemin si nécessaire

const taskCtrl = {
  // createTask: async (req, res) => {
  //   try {
  //     const {
  //       firstName,
  //       lastName,
  //       phoneNumber,
  //       phoneNumber2,
  //       email,
  //       available,
  //       Objectsposition,
  //       location,
  //       date,
  //       object,
  //       price,
  //       paymentStatus,
  //       StandardItem,
  //       cloneClientObjectPhotos,
  //     } = req.body;

  //     let clientObjectPhotos = [];

  //     if (cloneClientObjectPhotos) {
  //       clientObjectPhotos = cloneClientObjectPhotos;
  //     } else {
  //       clientObjectPhotos = req.files.map((file) => file.path);
  //     }

  //     const taskDate = new Date(date);

  //     const blockedDay = await BlockingDays.findOne({
  //       date: taskDate,
  //     });

  //     if (blockedDay) {
  //       return res.status(400).json({
  //         message: `Task date conflicts with a blocking day: ${blockedDay.type}`,
  //       });
  //     }

  //     const conflictingTruck = await Truck.findOne({
  //       $or: [
  //         {
  //           'driverSpecificDays.startDate': { $lte: taskDate },
  //           'driverSpecificDays.endDate': { $gte: taskDate },
  //         },
  //         {
  //           'helperSpecificDays.startDate': { $lte: taskDate },
  //           'helperSpecificDays.endDate': { $gte: taskDate },
  //         },
  //       ],
  //     });

  //     if (conflictingTruck) {
  //       return res.status(400).json({
  //         message: `Task date conflicts with the blocking days for truck: ${conflictingTruck.name}`,
  //       });
  //     }
  //     const newTask = new Task({
  //       firstName,
  //       lastName,
  //       phoneNumber,
  //       phoneNumber2,
  //       email,
  //       available,
  //       Objectsposition,
  //       location,
  //       date,
  //       object,
  //       price,
  //       paymentStatus,
  //       clientObjectPhotos,
  //       StandardItem,
  //       taskStatus: 'Created',
  //     });

  //     await newTask.save();

  //     res.status(201).json({
  //       message: 'Task created successfully',
  //       task: newTask,
  //     });
  //   } catch (error) {
  //     res
  //       .status(400)
  //       .json({ message: 'Failed to create task', error: error.message });
  //   }
  // },

  createTask: async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            phoneNumber,
            phoneNumber2,
            email,
            available,
            location,
            date,
            objects, // Tableau pour les objets personnalisés
            standardItems, // Tableau d'ID de StandardItem avec quantité et position
            paymentStatus,
            cloneClientObjectPhotos,
        } = req.body;

        let clientObjectPhotos = [];

        // Gestion des photos
        if (cloneClientObjectPhotos) {
            clientObjectPhotos = cloneClientObjectPhotos;
        } else if (req.files && req.files.length > 0) {
            clientObjectPhotos = req.files.map((file) => file.path);
        }

        const taskDate = new Date(date);

        // Vérification des jours bloqués
        const blockedDay = await BlockingDays.findOne({ date: taskDate });
        if (blockedDay) {
            return res.status(400).json({
                message: `Task date conflicts with a blocking day: ${blockedDay.type}`,
            });
        }

        // Vérification de la disponibilité du camion
        const conflictingTruck = await Truck.findOne({
            $or: [
                {
                    'driverSpecificDays.startDate': { $lte: taskDate },
                    'driverSpecificDays.endDate': { $gte: taskDate },
                },
                {
                    'helperSpecificDays.startDate': { $lte: taskDate },
                    'helperSpecificDays.endDate': { $gte: taskDate },
                },
            ],
        });
        if (conflictingTruck) {
            return res.status(400).json({
                message: `Task date conflicts with the blocking days for truck: ${conflictingTruck.name}`,
            });
        }

        // Construction des items pour la tâche
        const items = [];

        // Ajout des objets personnalisés
        if (objects && Array.isArray(objects)) {
            objects.forEach((customObject) => {
                if (customObject.object && customObject.price) {
                    items.push({
                        object: customObject.object,
                        price: customObject.price,
                        Objectsposition: customObject.Objectsposition || "Outside", // Position par défaut
                        quantity: customObject.quantity || 1, // Quantité par défaut
                    });
                }
            });
        }

        // Ajout des StandardItems
        if (standardItems && Array.isArray(standardItems)) {
            for (const item of standardItems) {
                const standardItem = await StandardItem.findById(item.standardItemId);
                if (!standardItem) {
                    return res.status(404).json({ message: `Standard item not found for ID: ${item.standardItemId}` });
                }
                items.push({
                    standardItemId: standardItem._id,
                    quantity: item.quantity || 1,
                    Objectsposition: item.Objectsposition || "Outside", // Position par défaut
                });
            }
        }

        const newTask = new Task({
            firstName,
            lastName,
            phoneNumber,
            phoneNumber2,
            email,
            available,
            location,
            date: taskDate,
            paymentStatus,
            clientObjectPhotos,
            items,
            taskStatus: 'Processing',
        });

        await newTask.save();

        res.status(201).json({
            message: 'Task created successfully',
            task: newTask,
        });
    } catch (error) {
        res.status(400).json({ message: 'Failed to create task', error: error.message });
    }
},

  getTaskById: async (req, res) => {
    const { taskId } = req.params;

    try {
      const task = await Task.findById(taskId);
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
      const { page, limit, filters } = req.query;

      let query = Task.find();
      const total = await Task.countDocuments(query);
      const features = new APIfeatures(query, req.query);

      if (filters) {
        features.filtering();
      }

      features.sorting().paginating();

      let tasks = await features.query.exec();

      tasks = await Promise.all(
        tasks.map(async (task) => {
          if (task.truckId) {
            const truck = await Truck.findById(task.truckId);
            task = task.toObject();
            task.truckName = truck ? truck.name : null;
          }
          return task;
        }),
      );

      const currentPage = parseInt(req.query.page, 10) || 1;
      const limitNum = parseInt(req.query.limit, 10) || 9;

      res.status(200).json({
        message: 'All tasks retrieved successfully',
        tasks,
        meta: {
          currentPage,
          limit: limitNum,
          total,
          count: tasks.length,
        },
      });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to retrieve tasks', error: error.message });
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
  
  updateTaskOrderInTruck : async (req, res) => {
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
        !['Created', 'Declined', 'Processing', 'Completed'].includes(taskStatus)
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
    const { taskId } = req.params;

    try {
      const existingTask = await Task.findById(taskId);
      if (!existingTask) {
        return res.status(404).json({ message: 'Task not found' });
      }

      let updateData = { ...req.body };
      if (req.body.deletedMedia && req.body.deletedMedia.length > 0) {
        existingTask.clientObjectPhotos =
          existingTask.clientObjectPhotos.filter(
            (photo) => !req.body.deletedMedia.includes(photo),
          );

        await existingTask.save();
      }

      if (req.files) {
        const newClientObjectPhotos = req.files.map((file) => file.path);

        const updatedClientObjectPhotos = existingTask.clientObjectPhotos
          ? existingTask.clientObjectPhotos.concat(newClientObjectPhotos)
          : newClientObjectPhotos;

        updateData.clientObjectPhotos = updatedClientObjectPhotos;
      }

      const updatedTask = await Task.findByIdAndUpdate(
        taskId,
        { $set: updateData },
        { new: true },
      );

      if (!updatedTask) {
        return res.status(404).json({ message: 'Task not found' });
      }

      res
        .status(200)
        .json({ message: 'Task updated successfully', task: updatedTask });
    } catch (error) {
      console.log(error);
      res
        .status(500)
        .json({ message: 'Failed to update task', error: error.message });
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
    const { taskId } = req.params; // Récupérer l'ID de la tâche depuis les paramètres
    const { paymentType } = req.body; // Le type de paiement (stripe ou paypal) est dans le body

    try {
        // Récupérer la tâche avec ses détails
        const task = await Task.findById(taskId).populate("items.standardItemId");
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Créer l'objet selectedQuantities automatiquement depuis les items de la tâche
        const selectedQuantities = {};
        task.items.forEach((item) => {
            if (item.standardItemId) {
                selectedQuantities[item.standardItemId._id.toString()] = item.quantity || 1;
            }
        });

        // Construire le breakdown des items et calculer le prix total
        const breakdown = task.items.map((item) => {
            const itemQuantity = selectedQuantities[item.standardItemId?._id?.toString()] || item.quantity || 1; // Quantité récupérée automatiquement
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

        // Ajouter des frais supplémentaires en fonction de la position des objets
        task.items.forEach((item) => {
            if (item.Objectsposition === "InsideWithDismantling") additionalFees += 18;
            else if (item.Objectsposition === "Inside") additionalFees += 6;
        });

        let finalPrice = basePrice + additionalFees;

        // Appliquer une réduction de 10% si toutes les conditions sont remplies
        if (task.available === "AnyTime" && task.items.every((i) => i.Objectsposition === "Outside")) {
            finalPrice *= 0.9; // Réduction de 10%
        }

        // Montant minimum de 30£
        if (finalPrice < 30) {
            finalPrice = 30;
        }

        const vat = finalPrice * 0.2; // 20% de TVA
        finalPrice += vat; // Ajouter la TVA au prix final

        // Préparer le breakdown final avec TVA et prix total
        const fullBreakdown = [
            ...breakdown,
            { description: "VAT (20%)", amount: vat.toFixed(2) },
            { description: "Final Total Price", amount: finalPrice.toFixed(2) },
        ];

        // Convertir le montant en pence pour Stripe et PayPal
        const finalAmountInPence = Math.round(finalPrice * 100); // En pence pour Stripe et PayPal

        let paymentResult;
        switch (paymentType) {
            case 'stripe':
                paymentResult = await createStripePaymentIntent(finalAmountInPence, taskId, fullBreakdown);
                return res.json({
                    message: 'Stripe payment initiated successfully',
                    clientSecret: paymentResult.client_secret,
                    paymentIntentId: paymentResult.id,
                    amount: finalAmountInPence,
                    paymentType,
                    breakdown: fullBreakdown,
                });

            case 'paypal':
                paymentResult = await createPayPalOrder(finalAmountInPence, taskId, fullBreakdown, task);
                return res.json({
                    message: 'PayPal payment initiated successfully',
                    orderID: paymentResult.result.id,
                    approvalLink: paymentResult.result.links.find((link) => link.rel === 'approve')?.href || null,
                    amount: finalAmountInPence,
                    paymentType,
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
        paymentType: 'stripe',
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
        paymentType: 'paypal',
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
    const { notes } = req.body;
    try {
        // Retrieve task
        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Calculate total price and breakdown
        const { total, breakdown } = await calculateTotalPrice(taskId);

        // Get the initial price in pence
        const initialPrice = task.price * 100; // Assuming task.price is in pounds

        // Prepare task details
        const taskDetails = {
            Objectsposition: task.Objectsposition || "N/A",
            available: task.available || "N/A",
        };

        // Generate Stripe payment link
        const stripeLink = await createStripePaymentLink(
            taskId,
            total,
            initialPrice,
            breakdown
        );

        // Generate PayPal payment link
        const paypalLink = await createPaypalPaymentLink(
            taskId,
            total,
            initialPrice,
            breakdown,
            taskDetails
        );

        // Send email
        await sendPayementEmail({
            customerEmail: task.email,
            taskId,
            stripeLink,
            paypalLink,
            totalPrice: total,
            breakdown,
            initialPrice,
            notes,
            taskDetails: task,
        });

        res.status(200).json({
            message: 'Payment links generated successfully and email sent',
            stripeLink,
            paypalLink,
        });
    } catch (error) {
        console.error('Error generating payment links:', error);
        res.status(500).json({ message: 'Failed to generate payment links', error: error.message });
    }
},


handleStripeWebhook: async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log("Webhook verified:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const taskId = session.metadata.taskId;

      if (!taskId) {
        console.error("Task ID missing in session metadata");
        return res.status(400).send("Task ID is required");
      }

      const task = await Task.findById(taskId).populate("items.standardItemId");
      if (!task) {
        console.error(`Task not found for ID: ${taskId}`);
        return res.status(404).send("Task not found");
      }

      // Construction du breakdown des items
      const breakdown = task.items.map((item) => ({
        itemDescription: item.standardItemId ? item.standardItemId.itemName : item.object,
        quantity: item.quantity || 1,
        price: item.standardItemId ? item.standardItemId.price : item.price || 0,
        Objectsposition: item.Objectsposition,
      }));

      // Marquer la tâche comme "Paid"
      task.paymentStatus = "Paid";
      await task.save();

      const payerAccount = session.customer_details?.email || "Unknown Payer (Stripe)";
      const paymentDate = new Date();

      // Créer une entrée PaymentHistory
      await PaymentHistory.create({
        taskId: task._id,
        firstName: task.firstName,
        lastName: task.lastName,
        phoneNumber: task.phoneNumber,
        amount: session.amount_total / 100,
        currency: session.currency.toUpperCase(),
        paymentType: "stripe",
        paymentDate,
        transactionId: session.payment_intent,
        payerAccount,
        breakdown, // Ajout des détails des items
      });

      // Envoi de l'email de confirmation
      await sendPaymentConfirmationEmail({
        email: task.email,
        firstName: task.firstName,
        lastName: task.lastName,
        orderId: taskId,
        paymentDate: paymentDate.toLocaleString(),
        amount: session.amount_total / 100,
        currency: session.currency.toUpperCase(),
        paymentType: "Stripe",
        taskDetails: task,
        breakdown,
      });

      console.log(`Payment for Task ${taskId} confirmed and email sent.`);
      res.status(200).send("Webhook received");
    }
  } catch (err) {
    console.error(`Webhook error: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
},

 handlePaypalWebhook : async (req, res) => {
  try {
      const event = req.body;

      if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
          const orderId = event.resource.id;
          const taskId = event.resource.purchase_units[0].custom_id;

          const task = await Task.findById(taskId).populate("items.standardItemId");
          if (!task) {
              console.error(`Task not found for ID: ${taskId}`);
              return res.status(404).send("Task not found");
          }

          // Capture du paiement
          const captureResponse = await capturePayPalPayment(orderId);

          if (captureResponse.status === "COMPLETED") {
            const payerInfo = captureResponse.payer;
            const payerAccount = payerInfo.email_address || `PayPal ID: ${payerInfo.payer_id}` || "Unknown Payer (PayPal)";
            const amount = parseFloat(captureResponse.purchase_units[0].payments.captures[0].amount.value);
            const currency = captureResponse.purchase_units[0].payments.captures[0].amount.currency_code;
            const paymentDate = new Date();
        
            // Construction du breakdown des items
            const breakdown = task.items.map((item) => ({
                itemDescription: item.standardItemId ? item.standardItemId.itemName : item.object,
                quantity: item.quantity || 1,
                price: item.standardItemId ? item.standardItemId.price : item.price || 0,
                Objectsposition: item.Objectsposition,
            }));
        
            let basePrice = breakdown.reduce((sum, item) => sum + item.price * item.quantity, 0);
            let additionalFees = 0;
        
            // Ajout des frais pour la position des items
            task.items.forEach((item) => {
                if (item.Objectsposition === "InsideWithDismantling") additionalFees += 18;
                else if (item.Objectsposition === "Inside") additionalFees += 6;
            });
        
            let finalPrice = basePrice + additionalFees;
        
            if (task.available === "AnyTime" && task.items.every((i) => i.Objectsposition === "Outside")) {
                finalPrice *= 0.9; // 10% de réduction
            }
        
            if (finalPrice < 30) {
                finalPrice = 30; // Minimum de £30
            }
        
            const vat = finalPrice * 0.2; // 20% TVA
            finalPrice += vat;
        
            // **Mise à jour du statut de la tâche comme "Paid"**
            task.paymentStatus = "Paid";
            await task.save(); // **Enregistrement de la tâche**
        
            await PaymentHistory.create({
                taskId: task._id,
                firstName: task.firstName,
                lastName: task.lastName,
                phoneNumber: task.phoneNumber,
                amount: finalPrice,
                currency,
                paymentType: "paypal",
                paymentDate,
                transactionId: captureResponse.purchase_units[0].payments.captures[0].id,
                payerAccount,
                breakdown: [
                    ...breakdown,
                    { description: "VAT (20%)", amount: vat.toFixed(2) },
                    { description: "Final Total Price", amount: finalPrice.toFixed(2) },
                ],
            });
        
            // Envoi de l'email de confirmation
            await sendPaymentConfirmationEmail({
                email: task.email,
                firstName: task.firstName,
                lastName: task.lastName,
                orderId: taskId,
                paymentDate: paymentDate.toLocaleString(),
                amount: finalPrice,
                currency,
                paymentType: "PayPal",
                breakdown: [
                    ...breakdown,
                    { description: "VAT (20%)", amount: vat.toFixed(2) },
                    { description: "Final Total Price", amount: finalPrice.toFixed(2) },
                ],
            });
        
            console.log(`Payment for Task ${taskId} recorded, status updated to "Paid", and email sent.`);
        }
        
      }

      res.status(200).send("Webhook processed successfully");
  } catch (error) {
      console.error("Error processing PayPal webhook:", error);
      res.status(500).send("Webhook processing failed");
  }
},
};

module.exports = taskCtrl;