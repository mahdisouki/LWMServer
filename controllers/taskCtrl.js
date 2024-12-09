const BlockingDays = require('../models/BlockingDays');
const Task = require('../models/Task');
const Truck = require('../models/Truck');
const APIfeatures = require('../utils/APIFeatures');
const paypal = require('@paypal/checkout-server-sdk');
const mongoose = require('mongoose');
const { getPayPalOrderDetails,capturePayPalPayment ,createPaypalPaymentLink,createStripePaymentLink,calculateTotalPrice, createStripePaymentIntent, createPayPalOrder ,PayPalClient } = require('../services/paymentService.js');
const PaymentHistory = require('../models/PaymentHistory.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const {createOptimoOrder} = require('../helper/OpitomRoute.js')
const nodemailer = require('nodemailer');
const sendPayementEmail = require('../utils/sendPayementEmail'); 
const sendPaymentConfirmationEmail = require("../utils/sendPayementRecivedEmail");


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

      res.status(201).json({ 
          message: 'Task created successfully', 
          task: newTask
        });
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
  
      const task = await Task.findById(taskId);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }
  
      // Extract taskDate from the task's `date` field
      const taskDate = task.date.toISOString().split('T')[0]; // Format: 'YYYY-MM-DD'
  
      // Update the task with the truck ID
      task.truckId = truck._id;
      await task.save();
  
      // Ensure `tasksByDate` exists for the truck
      if (!truck.tasksByDate) {
        truck.tasksByDate = {};
      }
  
      // Add the task ID to the specific date
      if (!truck.tasksByDate[taskDate]) {
        truck.tasksByDate[taskDate] = [];
      }
  
      if (!truck.tasksByDate[taskDate].includes(task._id.toString())) {
        truck.tasksByDate[taskDate].push(task._id.toString());
      }
  
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
        return res.status(400).json({ message: 'Task is not assigned to any truck' });
      }
  
      const truck = await Truck.findById(task.truckId);
      if (!truck) {
        return res.status(404).json({ message: 'Assigned truck not found' });
      }
  
      
      const taskDate = task.date.toISOString().split('T')[0]; 
  
      
      if (
        truck.tasksByDate &&
        truck.tasksByDate[taskDate] &&
        truck.tasksByDate[taskDate].includes(task._id.toString())
      ) {
        truck.tasksByDate[taskDate] = truck.tasksByDate[taskDate].filter(
          (id) => id !== task._id.toString()
        );
  
        // Remove the date entry if it becomes empty
        if (truck.tasksByDate[taskDate].length === 0) {
          delete truck.tasksByDate[taskDate];
        }
  
        await truck.save();
      }
  
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


generatePaymentLinks: async (req, res) => {
  const { taskId } = req.params;
  const  {notes} = req.body
  try {
      // Retrieve task by ID
      const task = await Task.findById(taskId);
      if (!task) {
          return res.status(404).json({ message: 'Task not found' });
      }

      // Extract options from the task itself
      const options = {
          position: task.position, // Assuming task has 'position' field
          timeSlot: task.timeSlot, // Assuming task has 'timeSlot' field
      };

      // Calculate the total price
      const amount = await calculateTotalPrice(taskId, options); // Amount in pence

      // Generate Stripe payment link
      const stripeLink = await createStripePaymentLink(taskId, amount);

      // Generate PayPal payment link
      const paypalLink = await createPaypalPaymentLink(taskId, amount);

      // Send email with payment links
      const customerEmail = task.email; // Assuming task has a customerEmail field
      const totalPrice = amount; // Total price in pence

      await sendPayementEmail({
          customerEmail,
          taskId,
          stripeLink,
          paypalLink,
          totalPrice,
          notes
      });

      // Respond with both payment links (optional)
      res.status(200).json({
          message: 'Payment links generated successfully and email sent',
          stripeLink,
          paypalLink,
      });
  } catch (error) {
      console.error('Error generating payment links:', error);
      res.status(500).json({
          message: 'Failed to generate payment links',
          error: error.message,
      });
  }
},



handleStripeWebhook: async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  try {
      const event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);

      if (event.type === "checkout.session.completed") {
          const session = event.data.object;
          const taskId = session.metadata.taskId;

          const task = await Task.findById(taskId);
          if (!task) {
              console.error(`Task not found for ID: ${taskId}`);
              return res.status(404).send("Task not found");
          }

          task.paymentStatus = "Paid";
          await task.save();

          const payerAccount = session.customer_email || "Unknown Payer (Stripe)";
          console.log("Payer Account:", payerAccount);

          const paymentDate = new Date();

          await PaymentHistory.create({
              taskId: task._id,
              firstName: task.firstName,
              lastName: task.lastName,
              phoneNumber: task.phoneNumber,
              amount: session.amount_total / 100,
              currency: session.currency.toUpperCase(),
              price: task.price,
              options: {
                  position: task.Objectsposition,
                  timeSlot: task.available,
              },
              paymentType: "stripe",
              paymentDate,
              transactionId: session.payment_intent,
              payerAccount,
          });

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
          });

          console.log(`Payment for Task ${taskId} completed and email sent.`);
      }

      res.status(200).send("Webhook received");
  } catch (err) {
      console.error(`Webhook error: ${err.message}`);
      res.status(400).send(`Webhook Error: ${err.message}`);
  }
},

handlePaypalWebhook: async (req, res) => {
  try {
      const event = req.body;

      if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
          const captureId = event.resource.id;
          const orderId = event.resource.supplementary_data.related_ids.order_id;

          const task = await Task.findById(orderId);
          if (!task) {
              console.error(`Task not found for ID: ${orderId}`);
              return res.status(404).send("Task not found");
          }

          task.paymentStatus = "Paid";
          await task.save();

          const payerInfo = event.resource.payer;
          const payerAccount = payerInfo.email_address || `PayPal ID: ${payerInfo.payer_id}` || "Unknown Payer (PayPal)";
          console.log("Payer Account:", payerAccount);

          const amount = parseFloat(event.resource.amount.value);
          const currency = event.resource.amount.currency_code;
          const paymentDate = new Date();

          await PaymentHistory.create({
              taskId: task._id,
              firstName: task.firstName,
              lastName: task.lastName,
              phoneNumber: task.phoneNumber,
              amount,
              currency,
              price: task.price,
              options: {
                  position: task.Objectsposition,
                  timeSlot: task.available,
              },
              paymentType: "paypal",
              paymentDate,
              transactionId: captureId,
              payerAccount,
          });

          await sendPaymentConfirmationEmail({
              email: task.email,
              firstName: task.firstName,
              lastName: task.lastName,
              orderId,
              paymentDate: paymentDate.toLocaleString(),
              amount,
              currency,
              paymentType: "PayPal",
              taskDetails: task,
          });

          console.log(`Payment for Task ${orderId} recorded and email sent.`);
      }

      res.status(200).send("Webhook processed successfully");
  } catch (error) {
      console.error("Error processing PayPal webhook:", error);
      res.status(500).send("Webhook processing failed");
  }
},

};

module.exports = taskCtrl;
