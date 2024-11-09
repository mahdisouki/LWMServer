const BlockingDays = require('../models/BlockingDays');
const Task = require('../models/Task');
const Truck = require('../models/Truck');
const APIfeatures = require('../utils/APIFeatures');
const paypal = require('@paypal/checkout-server-sdk');
const mongoose = require('mongoose');
const { calculateTotalPrice, createStripePaymentIntent, createPayPalOrder ,PayPalClient } = require('../services/paymentService.js');
const PaymentHistory = require('../models/PaymentHistory.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);



const taskCtrl = {
  createTask: async (req, res) => {
    try {
      const {
        firstName,
        lastName,
        phoneNumber,
        phoneNumber2,
        email,
        available,
        Objectsposition,
        location,
        date,
        object,
        price,
        paymentStatus,
        StandardItem,
        cloneClientObjectPhotos,
      } = req.body;

      let clientObjectPhotos = [];

      if (cloneClientObjectPhotos) {
        clientObjectPhotos = cloneClientObjectPhotos;
      } else {
        clientObjectPhotos = req.files.map((file) => file.path);
      }

      const taskDate = new Date(date);

      const blockedDay = await BlockingDays.findOne({
        date: taskDate,
      });

      if (blockedDay) {
        return res.status(400).json({
          message: `Task date conflicts with a blocking day: ${blockedDay.type}`,
        });
      }

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

      const newTask = new Task({
        firstName,
        lastName,
        phoneNumber,
        phoneNumber2,
        email,
        available,
        Objectsposition,
        location,
        date,
        object,
        price,
        paymentStatus,
        clientObjectPhotos,
        StandardItem,
        taskStatus: 'Created',
      });

      await newTask.save();
      res
        .status(201)
        .json({ message: 'Task created successfully', task: newTask });
    } catch (error) {
      res
        .status(400)
        .json({ message: 'Failed to create task', error: error.message });
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

      const updatedTask = await Task.findByIdAndUpdate(
        taskId,
        { $set: { truckId: truck._id } },
        { new: true },
      );

      if (!updatedTask) {
        return res.status(404).json({ message: 'Task not found' });
      }

      truck.tasks.push(updatedTask._id);
      await truck.save();

      res.status(200).json({
        message: 'Truck assigned to task successfully',
        task: updatedTask,
      });
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Failed to assign truck', error: error.message });
    }
  },
  deAssignTaskFromTruck: async (req, res) => {
    const { taskId } = req.params;

    try {
      // Find the task by ID
      const task = await Task.findById(taskId);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      // Check if the task is assigned to any truck
      if (!task.truckId) {
        return res.status(400).json({ message: 'Task is not assigned to any truck' });
      }

      // Find the truck assigned to the task
      const truck = await Truck.findById(task.truckId);
      if (!truck) {
        return res.status(404).json({ message: 'Assigned truck not found' });
      }

      // Remove the task from the truck's tasks list
      truck.tasks = truck.tasks.filter(
        (id) => id.toString() !== task._id.toString()
      );
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
      const task = await Task.findById(taskId);
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

      // Remove the task from the current truck's tasks list
      currentTruck.tasks = currentTruck.tasks.filter(
        (id) => id.toString() !== task._id.toString()
      );
      await currentTruck.save();

      // Update the task with the new truck ID
      task.truckId = newTruck._id;
      await task.save();

      // Add the task to the new truck's tasks list
      newTruck.tasks.push(task._id);
      await newTruck.save();

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
      console.log(error)
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
    const { taskId } = req.params; // Retrieve taskId from URL parameters
    const { paymentType } = req.body; // paymentType still comes from the body

    try {
        // Fetch the task to retrieve its options
        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        // Extract options from the task
        const options = {
            position: task.Objectsposition,
            timeSlot: task.available,
        };

        const amount = await calculateTotalPrice(taskId, options); // Calculate in cents

        let paymentResult;
        switch (paymentType) {
            case 'stripe':
                paymentResult = await createStripePaymentIntent(amount);
                return res.json({
                    message: 'Stripe payment initiated successfully',
                    clientSecret: paymentResult.client_secret,
                    paymentIntentId: paymentResult.id,
                    amount: amount,
                    paymentType, // Transmet le type de paiement
                    options // Include options to be used later in confirmation
                });

            case 'paypal':
                paymentResult = await createPayPalOrder(amount);
                const approvalLink = paymentResult.result.links.find(link => link.rel === 'approve');
                return res.json({
                    message: 'PayPal payment initiated successfully',
                    orderID: paymentResult.result.id,
                    approvalLink: approvalLink ? approvalLink.href : null,
                    amount: amount,
                    paymentType, // Transmet le type de paiement
                    options // Include options to be used later in confirmation
                });

            default:
                return res.status(400).json({ message: "Invalid payment method" });
        }
    } catch (error) {
        console.error('Payment Error:', error);
        return res.status(500).json({ message: "Failed to initiate payment", error: error.message });
    }
},

confirmStripeTaskPayment: async (req, res) => {
  const { paymentIntentId, paymentMethodId, taskId } = req.body;

  try {
      // Confirm the payment intent
      const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
          payment_method: paymentMethodId,
      });

      if (paymentIntent.status === 'succeeded') {
          const task = await Task.findById(taskId);
          if (!task) return res.status(404).json({ message: "Task not found" });

          task.paymentStatus = 'Paid';
          await task.save();

          // Retrieve charge details by listing the charges for this payment intent
          const charges = await stripe.charges.list({
              payment_intent: paymentIntentId,
              limit: 1, // Retrieve the most recent charge
          });

          const charge = charges.data[0];
          if (!charge) throw new Error('Charge not found for this payment');

          const payerAccount = charge.billing_details.email || charge.payment_method_details.card.last4;

          // Save payment history
          await PaymentHistory.create({
              taskId: task._id,
              firstName: task.firstName,
              lastName: task.lastName,
              phoneNumber: task.phoneNumber,
              amount: paymentIntent.amount,
              price: task.price,
              options: {
                  position: task.Objectsposition,
                  timeSlot: task.available,
              },
              paymentType: 'stripe', // Save the type of payment
              paymentDate: new Date(),
              transactionId: paymentIntentId, // Stripe paymentIntentId as transactionId
              payerAccount: payerAccount // Save payer's email or card last 4 digits
          });

          return res.status(200).json({
              message: 'Payment confirmed successfully',
              task,
              paymentIntent,
          });
      } else {
          return res.status(400).json({
              message: 'Payment confirmation failed',
              status: paymentIntent.status,
          });
      }
  } catch (error) {
      console.error('Error confirming payment:', error);
      res.status(500).json({ message: 'Error confirming payment', error: error.message });
  }
},

capturePayPalTaskPayment: async (req, res) => {
  const { orderID, taskId } = req.body;

  try {
      // Validate taskId to ensure it's a valid ObjectId
      if (!mongoose.Types.ObjectId.isValid(taskId)) {
          return res.status(400).json({ message: "Invalid taskId format" });
      }

      // Check if task exists
      const task = await Task.findById(taskId);
      if (!task) return res.status(404).json({ message: "Task not found" });

      // Attempt to capture the PayPal order
      const request = new paypal.orders.OrdersCaptureRequest(orderID);
      request.requestBody({}); // Empty body for capture request
      const capture = await PayPalClient().execute(request);

      // Check if the capture status is COMPLETED
      if (capture.result.status === 'COMPLETED') {
          task.paymentStatus = 'Paid';
          await task.save();

          // Extract the captured amount and payer information
          const amount = parseFloat(capture.result.purchase_units[0].payments.captures[0].amount.value) * 100; // Convert GBP to pence
          const transactionId = capture.result.purchase_units[0].payments.captures[0].id;
          const payerAccount = capture.result.payer.email_address;

          // Save payment history with transaction ID and payer account
          await PaymentHistory.create({
              taskId: task._id,
              firstName: task.firstName,
              lastName: task.lastName,
              phoneNumber: task.phoneNumber,
              amount: amount,
              price: task.price,
              options: {
                  position: task.Objectsposition,
                  timeSlot: task.available,
              },
              paymentType: 'paypal',
              paymentDate: new Date(),
              transactionId: transactionId,
              payerAccount: payerAccount
          });

          res.status(200).json({
              message: 'PayPal payment captured successfully',
              captureDetails: capture.result,
              task,
          });
      } else {
          res.status(400).json({ message: 'Failed to capture payment', capture });
      }
  } catch (error) {
      console.error('Error capturing PayPal payment:', error);
      res.status(500).json({ message: 'Failed to capture PayPal payment', error: error.message });
  }
},

};

module.exports = taskCtrl;
