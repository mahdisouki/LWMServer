const BlockingDays = require('../models/BlockingDays');
const Task = require('../models/Task');
const Truck = require('../models/Truck');
const { User } = require('../models/User');
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
const dailySheetController = require('./dailySheetController');
const NGROK_URL = 'https://api.londonwastemanagement.uk';
const CLIENT_URL = 'https://www.londonwastemanagement.com';
const Handlebars = require('handlebars');
const LOCK_DURATION = 30 * 60 * 1000;
const PaymentHistory = require('../models/PaymentHistory.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const sendPayementEmail = require('../utils/sendPayementEmail');
// const sendPaymentConfirmationEmail = require('../utils/sendPayementRecivedEmail');
const StandardItem = require('../models/StandardItem'); // Ajustez le chemin si nécessaire
const Coupon = require('../models/Coupon');
const { sendBookingConfirmationEmail, sendPaymentConfirmationEmail, sendPaymentFailedEmail } = require('../services/emailsService');
const { sendRetargetingEmail } = require('../utils/sendRetargetingEmail');
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
const cloudinary = require('../helper/cloudinaryConfig');
const { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } = require('../services/calendarService');
const { addStagingToSubject, addStagingBanner } = require('../utils/emailHelpers');

// Helper to update daily sheets when a task changes (e.g. status moved to Completed)
const updateDailySheetForTask = async (task) => {
  try {
    if (!task || !task.date) {
      return;
    }

    // Use task.date to determine which daily sheets to refresh
    const dateStr = new Date(task.date).toISOString().split('T')[0];

    const mockReq = {
      body: { date: dateStr },
    };
    const mockRes = {
      status: () => ({ json: () => { } }),
      json: () => { },
    };

    await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
    console.log('Daily sheets updated for tasks on date:', dateStr);
  } catch (error) {
    console.error('Error updating daily sheet for task:', error);
    // Do not throw – main operation (status change, etc.) must not fail because of this
  }
};

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
  createdByType,
  available, // Add available parameter for discount calculation
  applyMinFee = false, // Admin option to apply minimum fee
  couponCode = null, // Coupon code to apply
}) {
  console.log('🚀 CALCULATE TOTAL PRICE FUNCTION CALLED');
  console.log('Items received:', items);
  console.log('StandardItems received:', standardItems);
  console.log('Objects received:', objects);
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

      // Calculate base item subtotal using the price from the item itself
      let price = 0;
      const quantity = Number(item.quantity) || 1;

      // Calculate base item price (without position fees) multiplied by quantity
      let baseItemPrice = 0;
      let positionFee = 0;

      if (item.price && !isNaN(Number(item.price))) {
        // If item has a custom price, we need to extract the base price
        // For now, we'll use the base price from StandardItem and add position fee separately
        baseItemPrice = Number(standardItem.price); // Use base price from StandardItem
      } else {
        // Use base price from StandardItem
        baseItemPrice = Number(standardItem.price);
      }

      // Calculate position fee (multiplied by quantity)
      if (item.Objectsposition === 'InsideWithDismantling') {
        positionFee = Number(standardItem.insideWithDismantlingPrice);
      } else if (item.Objectsposition === 'Inside') {
        positionFee = Number(standardItem.insidePrice);
      } else {
        positionFee = 0; // Outside position has no additional fee
      }

      console.log('=== CALCULATE TOTAL PRICE DEBUG ===');
      console.log('Item:', item);
      console.log('StandardItem:', standardItem);
      console.log('Position:', item.Objectsposition, 'Type:', typeof item.Objectsposition);
      console.log('Base item price (without position fees):', baseItemPrice);
      console.log('Position fee (per unit):', positionFee);
      console.log('Quantity:', quantity);

      const itemSubtotal = (baseItemPrice * quantity) + (positionFee * quantity);
      console.log('Item subtotal (basePrice*quantity + positionFee*quantity):', itemSubtotal);
      console.log('Formula:', `(${baseItemPrice} × ${quantity}) + (${positionFee} × ${quantity}) = ${itemSubtotal}`);

      // Handle item-specific discount if discountType is "perItem"
      let finalItemTotal = itemSubtotal;
      if (
        hasDiscount &&
        discountType === 'perItem' &&
        typeof item.customPrice !== 'undefined' &&
        !isNaN(Number(item.customPrice))
      ) {
        // For custom prices, we still need to add position fees if they're not already included
        let customPrice = Number(item.customPrice);
        let positionFee = 0;

        // Add position fee if the custom price doesn't already include it
        if (item.Objectsposition === 'InsideWithDismantling') {
          positionFee = Number(standardItem.insideWithDismantlingPrice);
        } else if (item.Objectsposition === 'Inside') {
          positionFee = Number(standardItem.insidePrice);
        }

        finalItemTotal = (customPrice * quantity) + (positionFee * quantity);
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

  // 3.5. Apply coupon discount if coupon code is provided
  let couponDiscount = 0;
  let couponPercentage = 0;
  if (couponCode) {
    try {
      // Ensure couponCode is a string before calling toUpperCase
      const couponCodeStr = String(couponCode).trim();
      if (couponCodeStr) {
        const coupon = await Coupon.findOne({ code: couponCodeStr.toUpperCase() });
        if (coupon) {
          const validation = coupon.validateCoupon();
          if (validation.valid) {
            couponPercentage = validation.percentage;
            const subtotalBeforeCoupon = subtotal;
            couponDiscount = (subtotal * couponPercentage) / 100;
            // Explicitly subtract the discount - ensure it's a subtraction
            subtotal = Number((subtotal - couponDiscount).toFixed(2));
            console.log(`=== COUPON DISCOUNT DEBUG ===`);
            console.log(`Coupon Code: "${couponCodeStr}"`);
            console.log(`Coupon Percentage: ${couponPercentage}%`);
            console.log(`Subtotal before coupon: £${subtotalBeforeCoupon.toFixed(2)}`);
            console.log(`Coupon discount amount: £${couponDiscount.toFixed(2)}`);
            console.log(`Calculation: £${subtotalBeforeCoupon.toFixed(2)} - £${couponDiscount.toFixed(2)} = £${subtotal.toFixed(2)}`);
            console.log(`Subtotal after coupon: £${subtotal.toFixed(2)}`);
            console.log(`✅ Coupon "${couponCodeStr}" applied: ${couponPercentage}% discount = £${couponDiscount.toFixed(2)}`);
          } else {
            console.log(`⚠️ Coupon "${couponCodeStr}" is invalid: ${validation.message}`);
          }
        } else {
          console.log(`⚠️ Coupon code "${couponCodeStr}" not found`);
        }
      }
    } catch (error) {
      console.error('Error validating coupon:', error);
    }
  }

  // 4. Apply 10% discount if task is created by public, all items are 'Outside', and available === 'AnyTime'
  console.log('=== DISCOUNT CHECK DEBUG ===');
  console.log('available:', available, 'Type:', typeof available);
  console.log('createdByType:', createdByType, 'Type:', typeof createdByType);
  console.log('itemsToProcess.length:', itemsToProcess.length);
  console.log('All items Outside?', itemsToProcess.every((i) => i.Objectsposition === 'Outside'));
  console.log('Subtotal before discount:', subtotal);

  const isAvailableAnyTime = available === 'AnyTime';
  const isCreatedByPublic = createdByType === 'public';
  const hasItems = itemsToProcess.length > 0;
  const allItemsOutside = itemsToProcess.every((i) => i.Objectsposition === 'Outside');

  if (
    isAvailableAnyTime &&
    isCreatedByPublic &&
    hasItems &&
    allItemsOutside
  ) {
    console.log('✅ Applying 10% discount for Outside items with AnyTime and public type');
    subtotal *= 0.9;
    console.log('Subtotal after discount:', subtotal);
  } else {
    console.log('❌ Discount NOT applied - conditions not met');
    console.log('- available === "AnyTime":', isAvailableAnyTime);
    console.log('- createdByType === "public":', isCreatedByPublic);
    console.log('- itemsToProcess.length > 0:', hasItems);
    console.log('- All items Outside:', allItemsOutside);
  }

  // 5. Enforce minimum price (before VAT) - if under £37.5, make it £37.5
  // When total is under £37.5, the full payment becomes £45 (this is a complete payment, not partial)
  // Skip minimum price enforcement if created by Admin, UNLESS applyMinFee is true
  if ((createdByType !== 'Admin' || applyMinFee === true) && subtotal < 37.5) {
    subtotal = 37.5;
  }

  // 6. Add VAT (20%)
  const vat = subtotal * 0.2;
  const totalPrice = subtotal + vat;

  console.log(`=== FINAL PRICE CALCULATION ===`);
  console.log(`Final subtotal (after all discounts): £${subtotal.toFixed(2)}`);
  console.log(`VAT (20%): £${vat.toFixed(2)}`);
  console.log(`Total Price: £${totalPrice.toFixed(2)}`);
  if (couponDiscount > 0) {
    console.log(`Coupon discount applied: £${couponDiscount.toFixed(2)} (${couponPercentage}%)`);
  }

  return {
    totalPrice: Number(totalPrice.toFixed(2)),
    vat: Number(vat.toFixed(2)),
    couponDiscount: Number(couponDiscount.toFixed(2)),
    couponPercentage: couponPercentage,
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
        cashReceived,
        cashReceivedBy,
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
        applyMinFee, // Admin option to apply minimum fee
        orderNumber, // Optional order number (for migrations or manual entry)
        quotationId,
        couponCode, // Coupon code to apply
      } = req.body;
      if (createdByType === 'public') {
        const dateObj = new Date(date);
        const now = new Date();
        // Set time to midnight for date-only comparison (ignore time component)
        dateObj.setHours(0, 0, 0, 0);
        now.setHours(0, 0, 0, 0);
        
        console.log('date', date);
        console.log('dateObj', dateObj);
        console.log('now', now);
        
        if(isNaN(dateObj.getTime())) {
          return res.status(400).json({
            message: 'Invalid date format',
            error: 'INVALID_DATE'
          });
        }
        
        if(dateObj < now) {
          return res.status(400).json({
            message: 'Date cannot be in the past',
            error: 'DATE_IN_PAST'
          });
        }
      }
      console.log('req.body.location', req.body.location);
      // ✅ Convert FormData string to boolean
      // FormData sends boolean values as strings 'true' or 'false'
      const applyMinFeeBoolean = applyMinFee === 'true' || applyMinFee === true;

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

      // Validate coupon code if provided
      let coupon = null;
      let couponId = null;
      if (couponCode) {
        try {
          // Ensure couponCode is a string before calling toUpperCase
          const couponCodeStr = String(couponCode).trim();
          if (!couponCodeStr) {
            return res.status(400).json({
              message: 'Coupon code cannot be empty',
              error: 'COUPON_INVALID'
            });
          }

          coupon = await Coupon.findOne({ code: couponCodeStr.toUpperCase() });
          console.log('coupon', couponCode);
          if (coupon) {
            const validation = coupon.validateCoupon();
            if (!validation.valid) {
              return res.status(400).json({
                message: `Invalid coupon code: ${validation.message}`,
                error: 'COUPON_INVALID'
              });
            }
            couponId = coupon._id;
            console.log(`✅ Coupon "${couponCodeStr}" validated: ${validation.percentage}% discount`);
          } else {
            return res.status(400).json({
              message: 'Coupon code not found',
              error: 'COUPON_NOT_FOUND'
            });
          }
        } catch (error) {
          console.error('Error validating coupon:', error);
          return res.status(500).json({
            message: 'Error validating coupon code',
            error: error.message
          });
        }
      }

      // Calculate price using new logic
      console.log('=== PRICE CALCULATION DEBUG ===');
      console.log('Items being passed to calculateTotalPrice:', items);
      console.log('Objects being passed to calculateTotalPrice:', objects);
      console.log('available being passed:', available, 'Type:', typeof available);
      console.log('createdByType being passed:', createdByType, 'Type:', typeof createdByType);
      console.log('couponCode being passed:', couponCode);

      const { totalPrice, vat, couponDiscount, couponPercentage } = await calculateTotalPrice({
        items, // Pass items directly for the function
        objects,
        customDiscountPercent,
        discountType,
        hasDiscount,
        available,
        createdByType, // Pass createdByType for discount calculation
        applyMinFee: applyMinFeeBoolean, // ✅ Use converted boolean
        couponCode: couponCode || null, // Pass coupon code
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
            ewcCode: item.ewcCode || null, // Add EWC code support for custom items
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
        cashReceived,
        cashReceivedBy,
        paymentStatus: paymentStatus || 'Unpaid',
        billingAddress,
        collectionAddress,
        paymentMethod,
        clientObjectPhotos,
        totalPrice,
        items: allItems,
        taskStatus: 'New',
        postcode,
        customDiscountPercent,
        discountType,
        hasDiscount,
        orderNumber,
        couponCode: couponCode ? String(couponCode).trim().toUpperCase() : null,
        couponId: couponId,
        // customDiscountPercent !== undefined &&
        // !isNaN(customDiscountPercent) &&
        // customDiscountPercent > 0,
        additionalNotes,
        privateNotes,
        applyMinFee: applyMinFeeBoolean, // ✅ Use converted boolean
        quotationId: quotationId || null,
      });

      const savedTask = await newTask.save();

      // NOTE: Do NOT increment coupon usage here.
      // Coupon usage should be incremented only after successful payment confirmation/capture
      // (in confirmStripeTaskPayment or capturePayPalTaskPayment handlers).

      // Create a log of the task creation
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'CREATE',
          entityType: 'TASK',
          entityId: savedTask._id,
          changes: {
            created: savedTask.toObject(),
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      // Notify all admins when a public order is created
      if (createdByType !== 'public') {
        try {
          const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
          const customerName = savedTask.firstName && savedTask.lastName
            ? `${savedTask.firstName} ${savedTask.lastName}`
            : savedTask.bussinessName || 'Customer';
          const notificationMessage = `New public order created by ${customerName} - Order #${savedTask.orderNumber || savedTask._id}`;

          for (const admin of adminUsers) {
            if (admin._id) {
              await emitNotificationToUser(
                admin._id.toString(),
                'Orders',
                notificationMessage,
                customerName
              );
            }
          }
        } catch (notificationError) {
          console.error('Error sending notification to admins:', notificationError);
          // Don't fail the request if notification fails
        }
      }

      // Create Google Calendar event for the order
      let adminId = null; // Declare outside try block so it's accessible in catch
      try {
        // Get the first admin or the admin who created the task
        if (req.user && req.user.role && req.user.role.includes('Admin')) {
          adminId = req.user._id;
        } else {
          // Find first admin with Google tokens
          const admin = await User.findOne({
            role: 'Admin',
            gmailTokens: { $exists: true, $ne: null }
          });
          if (admin) {
            adminId = admin._id;
          }
        }

        if (adminId) {
          const calendarEvent = await createCalendarEvent(adminId.toString(), savedTask);

          // Save calendar event ID to task
          savedTask.googleCalendarEventId = calendarEvent.id;
          await savedTask.save();

          console.log('✅ Calendar event created for order:', savedTask.orderNumber);
        } else {
          console.log('⚠️ No admin with Google Calendar access found. Skipping calendar event creation.');
        }
      } catch (calendarError) {
        // Don't fail the task creation if calendar fails
        if (calendarError.message?.includes('CALENDAR_SCOPE_MISSING') ||
          calendarError.message?.includes('INVALID_GRANT')) {
          console.error('⚠️ Calendar integration requires re-authentication.');
          console.error('💡 Admin should visit: /api/gmail/auth/google?adminId=' + (adminId ? adminId.toString() : 'ADMIN_ID'));
        } else {
          console.error('❌ Error creating calendar event:', calendarError.message);
        }
        // Optionally log this error but don't throw
      }

      res.status(201).json({
        message: 'Task created successfully',
        task: savedTask,
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
      ).populate('couponId', 'code percentage discountType validFrom validTo maxUses currentUses');; // optional fields;
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
  getTaskByOrderNumber: async (req, res) => {
    const { orderNumber } = req.params;

    try {
      const task = await Task.findOne({ orderNumber }).populate(
        'createdBy',
        'email name',
      ).populate('couponId', 'code percentage discountType validFrom validTo maxUses currentUses');; // optional fields;
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
        ['paymentStatus', 'date', 'orderNumber', 'quotationId'], // filters
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

      // Update daily sheets for the driver
      try {
        if (truck.driverId) {
          console.log('Updating daily sheets for the driver1');
          // Call the updateExistingDailySheets function
          const mockReq = {
            body: { date: taskDate }
          };
          const mockRes = {
            status: () => ({ json: () => { } }),
            json: () => { }
          };

          await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
          console.log('Daily sheets updated after task assignment for date:', taskDate);
        }
      } catch (dailySheetError) {
        console.error('Error updating daily sheets after task assignment:', dailySheetError);
        // Don't fail the main operation if daily sheet update fails
      }

      // Create a log of the truck assignment
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'UPDATE',
          entityType: 'TASK',
          entityId: taskId,
          changes: {
            assignment: {
              type: 'assign_truck',
              truckName,
              truckId: truck._id,
              taskDate,
            },
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      res.status(200).json({
        message: 'Truck assigned to task successfully',
        task,
      });
    } catch (error) {
      console.log(error)
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

      // Update daily sheets for the driver
      try {
        if (truck.driverId) {
          // Call the updateExistingDailySheets function
          const mockReq = {
            body: { date: taskDate }
          };
          const mockRes = {
            status: () => ({ json: () => { } }),
            json: () => { }
          };

          await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
          console.log('Daily sheets updated after task de-assignment for date:', taskDate);
        }
      } catch (dailySheetError) {
        console.error('Error updating daily sheets after task de-assignment:', dailySheetError);
        // Don't fail the main operation if daily sheet update fails
      }

      // Create a log of the truck de-assignment
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'UPDATE',
          entityType: 'TASK',
          entityId: taskId,
          changes: {
            deassignment: {
              type: 'deassign_truck',
              truckId: truck._id,
              truckName: truck.name,
              taskDate,
            },
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      res.status(200).json({
        message: 'Task de-assigned from truck successfully',
        task,
      });
    } catch (error) {
      console.log(error)
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

      // Create a log of the truck move
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'UPDATE',
          entityType: 'TASK',
          entityId: taskId,
          changes: {
            move: {
              type: 'move_truck',
              fromTruckId: currentTruck._id,
              fromTruckName: currentTruck.name,
              toTruckId: newTruck._id,
              toTruckName: newTruckName,
              taskDate,
            },
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

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
      // Validate the reorderedTasks structure
      const validatedTasks = reorderedTasks.map((task, index) => {
        if (!task.taskId || !task.type) {
          throw new Error(`Invalid task structure at index ${index}. Must have taskId and type.`);
        }
        return {
          taskId: task.taskId,
          type: task.type,
          order: index + 1 // Set order based on array position
        };
      });

      const updatedTruck = await Truck.findOneAndUpdate(
        { _id: truckId }, // Query to find the truck
        { $set: { [`tasks.${date}`]: validatedTasks } }, // Dynamically update the tasks for the specific date
        { new: true }, // Return the updated document
      );

      if (!updatedTruck) {
        return res.status(404).json({ message: 'Truck not found' });
      }

      // Update daily sheets for the driver
      try {
        if (updatedTruck.driverId) {
          console.log('Updating daily sheets after task order change for driver:', updatedTruck.driverId);

          // Call the updateExistingDailySheets function
          const mockReq = {
            body: { date: date }
          };
          const mockRes = {
            status: () => ({ json: () => { } }),
            json: () => { }
          };

          await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
          console.log('Daily sheets updated after task order change for date:', date);
        }
      } catch (dailySheetError) {
        console.error('Error updating daily sheets after task order change:', dailySheetError);
        // Don't fail the main operation if daily sheet update fails
      }

      // Create a log of the task order update
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'UPDATE',
          entityType: 'TASK',
          entityId: null, // This affects multiple tasks
          changes: {
            orderUpdate: {
              type: 'update_task_order',
              truckId,
              date,
              reorderedTasks: validatedTasks,
            },
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      res.status(200).json({
        message: 'Task order updated successfully',
        tasks: updatedTruck.tasks.get(date), // Get the updated tasks for the specific date
        totalTasks: validatedTasks.length
      });
    } catch (error) {
      console.error('Error updating truck:', error);
      res.status(500).json({
        message: 'Failed to update task order',
        error: error.message,
      });
    }
  },
  //this is used by admin to update task status
  traiterTask: async (req, res) => {
    const { taskId } = req.params;
    const { taskStatus } = req.body;

    try {
      if (
        ![
          'Declined',
          'Processing',
          'New',
          'Completed',
          'Cancelled',
          'On_Hold',
          'Not_Completed',
          'Completed',
        ].includes(taskStatus)
      ) {
        return res.status(400).json({ message: 'Invalid task status' });
      }

      const oldTask = await Task.findById(taskId);
      if (!oldTask) {
        return res.status(404).json({ message: 'Task not found' });
      }

      const updatedTask = await Task.findByIdAndUpdate(
        taskId,
        { $set: { taskStatus } },
        { new: true },
      );

      // If the task status has just been switched to Completed, refresh daily sheets
      if (updatedTask && updatedTask.taskStatus === 'Completed') {
        await updateDailySheetForTask(updatedTask);
        // Send Waste Transfer Note email once per task
        await sendWasteTransferNoteEmail(updatedTask._id);
      }

      // Update Google Calendar event if it exists
      if (updatedTask.googleCalendarEventId) {
        try {
          let adminId = null;
          if (req.user && req.user.role && req.user.role.includes('Admin')) {
            adminId = req.user._id;
          } else {
            const admin = await User.findOne({
              role: 'Admin',
              gmailTokens: { $exists: true, $ne: null }
            });
            if (admin) adminId = admin._id;
          }

          if (adminId) {
            await updateCalendarEvent(adminId.toString(), updatedTask, updatedTask.googleCalendarEventId);
            console.log('✅ Calendar event updated for order:', updatedTask.orderNumber);
          }
        } catch (calendarError) {
          if (calendarError.message?.includes('CALENDAR_SCOPE_MISSING') ||
            calendarError.message?.includes('INVALID_GRANT')) {
            console.error('⚠️ Calendar integration requires re-authentication.');
            console.error('💡 Admin should visit: /api/gmail/auth/google?adminId=' + (adminId || 'ADMIN_ID'));
          } else {
            console.error('❌ Error updating calendar event:', calendarError.message);
          }
        }
      }

      // Create a log of the status change
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'UPDATE',
          entityType: 'TASK',
          entityId: taskId,
          changes: {
            before: { taskStatus: oldTask.taskStatus },
            after: { taskStatus: updatedTask.taskStatus },
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
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
      const { couponCode } = req.body; // Extract couponCode from request

      console.log('=== UPDATE TASK START ===');
      console.log('Task ID:', taskId);
      console.log('Request body:', JSON.stringify(req.body, null, 2));

      const oldTask = await Task.findById(taskId);
      if (!oldTask) {
        return res.status(404).json({ message: 'Task not found' });
      }

      // Validate coupon code if provided (similar to createTask)
      let coupon = null;
      let couponId = null;
      if (couponCode !== undefined) { // Allow clearing coupon if couponCode is explicitly null/empty
        if (couponCode) {
          try {
            const couponCodeStr = String(couponCode).trim();
            if (!couponCodeStr) {
              return res.status(400).json({
                message: 'Coupon code cannot be empty',
                error: 'COUPON_INVALID'
              });
            }

            const couponCodeUpper = couponCodeStr.toUpperCase();
            const existingCouponCode = oldTask.couponCode ? String(oldTask.couponCode).trim().toUpperCase() : '';
            
            // Only validate if it's a NEW/different coupon code (skip validation if same as existing)
            const isDifferentCoupon = couponCodeUpper !== existingCouponCode;
            
            coupon = await Coupon.findOne({ code: couponCodeUpper });
            if (coupon) {
              // Only validate if it's a different coupon from what's already saved
              if (isDifferentCoupon) {
                const validation = coupon.validateCoupon();
                if (!validation.valid) {
                  return res.status(400).json({
                    message: `Invalid coupon code: ${validation.message}`,
                    error: 'COUPON_INVALID'
                  });
                }
                console.log(`✅ New coupon "${couponCodeUpper}" validated for update: ${validation.percentage}% discount`);
              } else {
                console.log(`ℹ️ Coupon "${couponCodeUpper}" unchanged - skipping validation (already exists on task)`);
              }
              couponId = coupon._id;
              updates.couponCode = couponCodeUpper;
              updates.couponId = couponId;
            } else {
              return res.status(400).json({
                message: 'Coupon code not found',
                error: 'COUPON_NOT_FOUND'
              });
            }
          } catch (error) {
            console.error('Error validating coupon:', error);
            return res.status(500).json({
              message: 'Error validating coupon code',
              error: error.message
            });
          }
        } else {
          // Clear coupon if empty string or null
          updates.couponCode = null;
          updates.couponId = null;
        }
      }

      console.log('=== PHOTO HANDLING ===');
      // Handle clientObjectPhotos updates and deletions
      try {
        // Collect deleted media from various possible encodings
        let deletedMedia = [];
        if (Array.isArray(updates.deletedMedia)) {
          deletedMedia = updates.deletedMedia.filter(Boolean);
        } else if (typeof updates.deletedMedia === 'string') {
          try {
            const parsedDel = JSON.parse(updates.deletedMedia);
            if (Array.isArray(parsedDel)) deletedMedia = parsedDel.filter(Boolean);
            else if (parsedDel) deletedMedia = [parsedDel];
          } catch (_) {
            deletedMedia = [updates.deletedMedia];
          }
        } else if (updates && typeof updates === 'object') {
          // Handle deletedMedia[0], deletedMedia[1], ... style
          const dmKeys = Object.keys(updates).filter((k) => k.startsWith('deletedMedia['));
          if (dmKeys.length > 0) {
            // Sort by index inside brackets to be deterministic
            dmKeys.sort((a, b) => {
              const ai = Number(a.match(/deletedMedia\[(\d+)\]/)?.[1] || 0);
              const bi = Number(b.match(/deletedMedia\[(\d+)\]/)?.[1] || 0);
              return ai - bi;
            });
            deletedMedia = dmKeys.map((k) => updates[k]).filter(Boolean);
            // Clean these helper keys from updates
            dmKeys.forEach((k) => delete updates[k]);
          }
        }

        // Determine base set of photos
        let basePhotos = [];
        if (
          updates.cloneClientObjectPhotos &&
          Array.isArray(updates.cloneClientObjectPhotos)
        ) {
          basePhotos = updates.cloneClientObjectPhotos.filter(Boolean);
        } else if (oldTask && Array.isArray(oldTask.clientObjectPhotos)) {
          basePhotos = oldTask.clientObjectPhotos.slice();
        }

        // Remove deleted URLs from base
        if (deletedMedia.length > 0 && basePhotos.length > 0) {
          const toDeleteSet = new Set(deletedMedia);
          basePhotos = basePhotos.filter((url) => !toDeleteSet.has(url));
        }

        // Add newly uploaded files
        if (req.files && Array.isArray(req.files) && req.files.length > 0) {
          const uploaded = req.files.map((file) => file.path).filter(Boolean);
          basePhotos = basePhotos.concat(uploaded);
        }

        // Merge any photos provided in body
        if (typeof updates.clientObjectPhotos === 'string') {
          try {
            const parsed = JSON.parse(updates.clientObjectPhotos);
            if (Array.isArray(parsed)) {
              basePhotos = basePhotos.concat(parsed.filter(Boolean));
            } else if (parsed) {
              basePhotos = basePhotos.concat([parsed]);
            }
          } catch (_) {
            basePhotos = basePhotos.concat([updates.clientObjectPhotos]);
          }
        } else if (Array.isArray(updates.clientObjectPhotos)) {
          basePhotos = basePhotos.concat(updates.clientObjectPhotos.filter(Boolean));
        }

        // De-duplicate and finalize
        let nextPhotos = Array.from(new Set(basePhotos.filter(Boolean)));

        if (nextPhotos.length > 0) {
          updates.clientObjectPhotos = nextPhotos;
        } else {
          // Allow clearing all photos if nothing remains and deletions were requested
          if (deletedMedia.length > 0 || updates.clientObjectPhotos === '[]') {
            updates.clientObjectPhotos = [];
          } else {
            delete updates.clientObjectPhotos;
          }
        }

        // Attempt to delete removed Cloudinary assets
        if (deletedMedia.length > 0) {
          const parseCloudinaryInfo = (url) => {
            try {
              const u = new URL(url);
              if (!u.hostname.includes('res.cloudinary.com')) return null;
              const path = decodeURIComponent(u.pathname);
              const parts = path.split('/').filter(Boolean);
              const resourceType = parts[1];
              const uploadIndex = parts.indexOf('upload');
              if (uploadIndex === -1) return null;
              const rest = parts.slice(uploadIndex + 1);
              const withoutVersion = rest[0] && rest[0].startsWith('v') ? rest.slice(1) : rest;
              if (withoutVersion.length === 0) return null;
              const filePath = withoutVersion.join('/');
              const publicId = filePath.replace(/\.[^/.]+$/, '');
              return { resourceType: resourceType === 'video' ? 'video' : 'image', publicId };
            } catch (_) {
              return null;
            }
          };

          const deletions = deletedMedia
            .map((url) => parseCloudinaryInfo(url))
            .filter(Boolean)
            .map(({ resourceType, publicId }) =>
              cloudinary.uploader
                .destroy(publicId, { resource_type: resourceType })
                .catch((err) =>
                  console.warn('Cloudinary deletion failed for', publicId, err?.message || err),
                ),
            );

          if (deletions.length > 0) {
            await Promise.allSettled(deletions);
          }
        }
      } catch (e) {
        console.error('Error processing clientObjectPhotos/deletedMedia during update:', e);
      }

      // Do not persist helper fields
      delete updates.cloneClientObjectPhotos;
      delete updates.deletedMedia;

      console.log('=== ITEMS PROCESSING ===');
      // Check if we need to process items (either from updates.items or updates.objects)
      const hasItemsUpdate = updates.items !== undefined;
      const hasObjectsUpdate = updates.objects && Array.isArray(updates.objects) && updates.objects.length > 0;

      if (hasItemsUpdate || hasObjectsUpdate) {
        // Initialize items array
        if (updates.items === undefined) {
          // If items are not being updated but objects are, we need to handle this carefully
          // If objects are provided, we want to REPLACE existing custom items, not append
          if (hasObjectsUpdate) {
            // Start with existing standard items (items with standardItemId), exclude custom items
            updates.items = oldTask.items
              ? oldTask.items
                .map(item => item.toObject ? item.toObject() : item)
                .filter(item => item.standardItemId && mongoose.Types.ObjectId.isValid(item.standardItemId))
              : [];
            console.log('Preserved existing standard items, will replace custom items:', JSON.stringify(updates.items, null, 2));
          } else {
            // If no objects update, preserve all existing items
            updates.items = oldTask.items ? oldTask.items.map(item => item.toObject ? item.toObject() : item) : [];
            console.log('No items in update, preserving existing items:', JSON.stringify(updates.items, null, 2));
          }
        } else {
          console.log('Original items from request:', JSON.stringify(updates.items, null, 2));
        }

        // Clean and filter items
        updates.items = updates.items
          .map((item) => {
            console.log('Processing item:', JSON.stringify(item, null, 2));
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
            const isValid = (
              (item.standardItemId &&
                typeof item.standardItemId === 'string' &&
                item.standardItemId.trim() !== '' &&
                mongoose.Types.ObjectId.isValid(item.standardItemId)) ||
              (item.object && item.object.trim() !== '')
            );
            console.log('Item validation result:', isValid, 'for item:', item);
            return isValid;
          });

        console.log('Filtered items:', JSON.stringify(updates.items, null, 2));

        // Handle objects array (custom items) if present
        if (updates.objects && Array.isArray(updates.objects)) {
          console.log('Processing objects array:', JSON.stringify(updates.objects, null, 2));

          // Filter out empty/invalid objects
          const validObjects = updates.objects.filter((obj) => {
            return obj && obj.object && typeof obj.object === 'string' && obj.object.trim() !== '';
          });

          if (validObjects.length > 0) {
            const customItems = validObjects.map((obj) => {
              console.log('Processing custom object:', JSON.stringify(obj, null, 2));
              const customItem = {
                standardItemId: null, // Custom items don't have standardItemId
                object: obj.object,
                Objectsposition: obj.Objectsposition || 'Outside',
                quantity: Number(obj.quantity) || 1,
                customPrice: obj.customPrice !== undefined ? Number(obj.customPrice) : undefined,
                price: Number(obj.price) || 0,
                ewcCode: obj.ewcCode || null, // Add EWC code support for custom items
              };
              console.log('Converted custom item:', JSON.stringify(customItem, null, 2));
              return customItem;
            });

            // IMPORTANT: Remove existing custom items (items without standardItemId) before merging
            // This ensures we REPLACE custom items, not append to them
            const standardItems = updates.items.filter(item =>
              item.standardItemId && mongoose.Types.ObjectId.isValid(item.standardItemId)
            );

            // Merge standard items with new custom items
            updates.items = [...standardItems, ...customItems];
            console.log('Replaced custom items, merged with standard items:', JSON.stringify(updates.items, null, 2));
          } else {
            // If objects array is empty, remove all custom items (keep only standard items)
            updates.items = updates.items.filter(item =>
              item.standardItemId && mongoose.Types.ObjectId.isValid(item.standardItemId)
            );
            console.log('Objects array is empty, removed all custom items:', JSON.stringify(updates.items, null, 2));
          }
        }

        // Clean up helper field - objects array is merged into items, so remove it
        delete updates.objects;

        console.log('Final items to save:', JSON.stringify(updates.items, null, 2));

        // Save the new items first
        await Task.findByIdAndUpdate(taskId, {
          $set: { items: updates.items },
        });

        // Re-fetch the task with populated items
        const populatedTask = await Task.findById(taskId).populate('items.standardItemId');
        console.log('Populated task items:', JSON.stringify(populatedTask.items, null, 2));

        let subtotal = 0;

        console.log('=== PRICE CALCULATION ===');
        console.log('Task hasDiscount:', populatedTask.hasDiscount);
        console.log('Task discountType:', populatedTask.discountType);
        console.log('Task customDiscountPercent:', populatedTask.customDiscountPercent);

        // Calculate subtotal with discount handling
        for (const item of populatedTask.items) {
          console.log('\n--- Processing Item ---');
          console.log('Item:', JSON.stringify(item, null, 2));

          let itemPrice = 0;
          let positionFee = 0;
          const isCustomItem = !item.standardItemId;

          console.log('Is custom item:', isCustomItem);
          console.log('Item customPrice:', item.customPrice, 'Type:', typeof item.customPrice);

          if (item.standardItemId) {
            // Base item price (outside position)
            itemPrice = Number(item.standardItemId.price);
            console.log('Standard item base price:', itemPrice);

            // Position fee (multiplied by quantity)
            if (item.Objectsposition === 'InsideWithDismantling') {
              positionFee = Number(item.standardItemId.insideWithDismantlingPrice);
            } else if (item.Objectsposition === 'Inside') {
              positionFee = Number(item.standardItemId.insidePrice);
            }
            console.log('Position fee:', positionFee);
          } else if (item.price) {
            // Custom items use their own price
            itemPrice = Number(item.price);
            console.log('Custom item price:', itemPrice);
          }

          const quantity = Number(item.quantity) || 1;
          console.log('Quantity:', quantity);

          // Calculate total: (itemPrice * quantity) + (positionFee * quantity)
          let finalItemTotal;

          if (item.standardItemId) {
            // For standard items: (itemPrice * quantity) + (positionFee * quantity)
            finalItemTotal = (itemPrice * quantity) + (positionFee * quantity);
          } else {
            // For custom items: itemPrice * quantity (no position fee)
            finalItemTotal = itemPrice * quantity;
          }

          console.log('Initial finalItemTotal:', finalItemTotal);

          // Handle item-specific discount if discountType is "perItem"
          const discountCondition = (
            populatedTask.hasDiscount &&
            populatedTask.discountType === 'perItem' &&
            item.customPrice !== undefined &&
            item.customPrice !== null
          );

          console.log('Discount condition check:');
          console.log('- hasDiscount:', populatedTask.hasDiscount);
          console.log('- discountType === "perItem":', populatedTask.discountType === 'perItem');
          console.log('- customPrice !== undefined:', item.customPrice !== undefined);
          console.log('- customPrice !== null:', item.customPrice !== null);
          console.log('- Final discount condition:', discountCondition);

          if (discountCondition) {
            let customPrice = Number(item.customPrice);
            console.log('Applying custom price discount:', customPrice);

            if (item.standardItemId) {
              // For standard items with discount: (customPrice * quantity) + (positionFee * quantity)
              finalItemTotal = (customPrice * quantity) + (positionFee * quantity);
              console.log('Standard item with discount formula:', `(${customPrice} × ${quantity}) + (${positionFee} × ${quantity}) = ${finalItemTotal}`);
            } else {
              // For custom items with discount: customPrice * quantity
              finalItemTotal = customPrice * quantity;
              console.log('Custom item with discount formula:', `${customPrice} × ${quantity} = ${finalItemTotal}`);
            }
          }

          console.log('Final item total:', finalItemTotal);
          subtotal += finalItemTotal;
          console.log('Running subtotal:', subtotal);
        }

        // Handle percentage discount if discountType is "percentage"
        if (
          populatedTask.hasDiscount &&
          populatedTask.discountType === 'percentage' &&
          populatedTask.customDiscountPercent > 0
        ) {
          const percentageDiscount = (subtotal * populatedTask.customDiscountPercent) / 100;
          subtotal -= percentageDiscount;
          console.log('Applied percentage discount:', percentageDiscount, 'New subtotal:', subtotal);
        }

        // Apply coupon discount (AFTER percentage discount, BEFORE VAT)
        let couponDiscount = 0;
        // Use new coupon if provided, otherwise use existing coupon from task when recalculating
        // This ensures existing coupons are preserved when recalculating due to item updates
        const couponCodeToUse = updates.couponCode !== undefined 
          ? (updates.couponCode || null) // Allow clearing coupon with empty string/null
          : populatedTask.couponCode; // Preserve existing coupon when recalculating

        // Determine if this is a new coupon (needs validation) or existing coupon (skip validation)
        // Skip validation if:
        // 1. No couponCode provided in update (undefined), OR
        // 2. The couponCode matches what's already saved in the database
        // Only validate if a new/different coupon code is being provided
        const isNewCoupon = updates.couponCode !== undefined && 
          String(updates.couponCode || '').trim().toUpperCase() !== String(populatedTask.couponCode || '').trim().toUpperCase();
        console.log('isNewCoupon:', isNewCoupon);
        console.log('String(updates.couponCode || "").trim().toUpperCase():', String(updates.couponCode || "").trim().toUpperCase());
        console.log('String(populatedTask.couponCode || "").trim().toUpperCase():', String(populatedTask.couponCode || "").trim().toUpperCase());
        console.log('=== COUPON APPLICATION DEBUG (updateTask) ===');
        console.log('updates.couponCode:', updates.couponCode);
        console.log('populatedTask.couponCode:', populatedTask.couponCode);
        console.log('couponCodeToUse:', couponCodeToUse);
        console.log('isNewCoupon:', isNewCoupon);
        console.log('coupon variable (from validation):', coupon ? coupon.code : 'null');

        if (couponCodeToUse) {
          try {
            const couponCodeStr = String(couponCodeToUse).trim().toUpperCase();
            console.log('Looking up coupon with code:', couponCodeStr);
            
            // Use already validated coupon from earlier if available, otherwise fetch it
            let couponToApply = coupon;
            if (!couponToApply) {
              console.log('Coupon not validated earlier, fetching from database...');
              couponToApply = await Coupon.findOne({ code: couponCodeStr });
              console.log('Coupon found from DB:', couponToApply ? 'Yes' : 'No');
            } else {
              console.log('Using already validated coupon from top section');
            }
            
            if (couponToApply) {
              // Only validate NEW coupons that haven't been validated yet in this request
              // If coupon was already validated at the top (coupon variable exists), skip validation
              const needsValidation = isNewCoupon && !coupon;
              
              if (needsValidation) {
                const validation = couponToApply.validateCoupon();
                console.log('Coupon validation result (NEW coupon, first validation):', validation);
                
                if (validation.valid) {
                  const couponPercentage = validation.percentage;
                  const subtotalBeforeCoupon = subtotal;
                  couponDiscount = (subtotal * couponPercentage) / 100;
                  subtotal = Number((subtotal - couponDiscount).toFixed(2));
                  console.log('=== COUPON DISCOUNT APPLIED (updateTask) ===');
                  console.log(`Coupon Code: "${couponCodeStr}"`);
                  console.log(`Coupon Source: New/Updated (validated in price calc)`);
                  console.log(`Coupon Percentage: ${couponPercentage}%`);
                  console.log(`Subtotal before coupon: £${subtotalBeforeCoupon.toFixed(2)}`);
                  console.log(`Coupon discount amount: £${couponDiscount.toFixed(2)}`);
                  console.log(`Calculation: £${subtotalBeforeCoupon.toFixed(2)} - £${couponDiscount.toFixed(2)} = £${subtotal.toFixed(2)}`);
                  console.log(`Subtotal after coupon: £${subtotal.toFixed(2)}`);
                  console.log(`✅ Coupon applied in updateTask: ${couponPercentage}% discount = £${couponDiscount.toFixed(2)}`);
                } else {
                  console.log(`⚠️ Coupon "${couponCodeStr}" is invalid in updateTask: ${validation.message}`);
                  console.log('⚠️ Coupon validation failed, discount NOT applied');
                }
              } else if (coupon) {
                // Coupon was already validated at the top section - use it without re-validation
                const couponPercentage = couponToApply.percentage || 0;
                if (couponPercentage > 0) {
                  const subtotalBeforeCoupon = subtotal;
                  couponDiscount = (subtotal * couponPercentage) / 100;
                  subtotal = Number((subtotal - couponDiscount).toFixed(2));
                  console.log('=== COUPON DISCOUNT APPLIED (updateTask) ===');
                  console.log(`Coupon Code: "${couponCodeStr}"`);
                  console.log(`Coupon Source: New/Updated (already validated at top)`);
                  console.log(`Coupon Percentage: ${couponPercentage}%`);
                  console.log(`Subtotal before coupon: £${subtotalBeforeCoupon.toFixed(2)}`);
                  console.log(`Coupon discount amount: £${couponDiscount.toFixed(2)}`);
                  console.log(`Calculation: £${subtotalBeforeCoupon.toFixed(2)} - £${couponDiscount.toFixed(2)} = £${subtotal.toFixed(2)}`);
                  console.log(`Subtotal after coupon: £${subtotal.toFixed(2)}`);
                  console.log(`✅ Coupon applied (already validated): ${couponPercentage}% discount = £${couponDiscount.toFixed(2)}`);
                } else {
                  console.log(`⚠️ Coupon has invalid percentage: ${couponPercentage}%`);
                }
              } else {
                // Existing coupon: skip validation, use percentage directly from coupon document
                const couponPercentage = couponToApply.percentage || 0;
                if (couponPercentage > 0) {
                  const subtotalBeforeCoupon = subtotal;
                  couponDiscount = (subtotal * couponPercentage) / 100;
                  subtotal = Number((subtotal - couponDiscount).toFixed(2));
                  console.log('=== COUPON DISCOUNT APPLIED (updateTask) ===');
                  console.log(`Coupon Code: "${couponCodeStr}"`);
                  console.log(`Coupon Source: Existing (no validation)`);
                  console.log(`Coupon Percentage: ${couponPercentage}%`);
                  console.log(`Subtotal before coupon: £${subtotalBeforeCoupon.toFixed(2)}`);
                  console.log(`Coupon discount amount: £${couponDiscount.toFixed(2)}`);
                  console.log(`Calculation: £${subtotalBeforeCoupon.toFixed(2)} - £${couponDiscount.toFixed(2)} = £${subtotal.toFixed(2)}`);
                  console.log(`Subtotal after coupon: £${subtotal.toFixed(2)}`);
                  console.log(`✅ Existing coupon applied (no validation): ${couponPercentage}% discount = £${couponDiscount.toFixed(2)}`);
                } else {
                  console.log(`⚠️ Existing coupon has invalid percentage: ${couponPercentage}%`);
                }
              }
            } else {
              console.error(`❌ Coupon "${couponCodeStr}" not found in database!`);
              console.error('❌ Discount NOT applied - coupon lookup failed');
            }
          } catch (error) {
            console.error('❌ Error applying coupon in updateTask:', error);
            console.error('Error details:', error.message, error.stack);
          }
        } else {
          console.log('No coupon code to use (neither in update nor in existing task)');
        }

        // Add VAT (after coupon discount)
        let vat = subtotal * 0.2;
        let totalPrice = subtotal + vat;

        // Apply minimum fee if needed
        const enforceMinimumPrice = populatedTask.createdByType !== 'Admin' || populatedTask.applyMinFee === true;
        if (enforceMinimumPrice && subtotal < 37.5) {
          subtotal = 37.5;
          vat = subtotal * 0.2;
          totalPrice = subtotal + vat;
          console.log('Applied minimum price adjustment in updateTask');
        }

        console.log('Final subtotal:', subtotal);
        console.log('VAT:', vat);
        console.log('Calculated totalPrice with VAT:', totalPrice);

        updates.totalPrice = totalPrice;
      }

      console.log('=== CUSTOM PRICE SANITIZATION ===');
      // Before saving or updating a task, sanitize customPrice for all items
      if (updates.items) {
        console.log('Items before sanitization:', JSON.stringify(updates.items, null, 2));

        updates.items = updates.items.map((item) => {
          console.log('Sanitizing item:', JSON.stringify(item, null, 2));

          if (
            item.customPrice === '' ||
            item.customPrice === null ||
            item.customPrice === undefined ||
            item.customPrice === 'undefined' ||
            typeof item.customPrice === 'undefined'
          ) {
            console.log('Deleting customPrice for item:', item);
            delete item.customPrice;
          } else {
            // Convert to number, but preserve 0 as a valid value
            const numValue = Number(item.customPrice);
            if (!isNaN(numValue)) {
              item.customPrice = numValue;
              console.log('Set customPrice to:', numValue);
            } else {
              console.log('Deleting customPrice (NaN):', item.customPrice);
              delete item.customPrice;
            }
          }
          return item;
        });

        console.log('Items after sanitization:', JSON.stringify(updates.items, null, 2));
      }

      console.log('=== FINAL UPDATE ===');
      console.log('Updates to apply:', JSON.stringify(updates, null, 2));

      // Update the task
      const updatedTask = await Task.findByIdAndUpdate(
        taskId,
        { $set: updates },
        { new: true },
      );

      console.log('Updated task:', JSON.stringify(updatedTask, null, 2));

      // Update Google Calendar event if it exists and relevant fields changed
      // if (updatedTask.googleCalendarEventId && (
      //   updates.date || updates.available || updates.taskStatus ||
      //   updates.firstName || updates.lastName || updates.location ||
      //   updates.items || updates.totalPrice
      // )) {
      //   try {
      //     let adminId = null;
      //     if (req.user && req.user.role && req.user.role.includes('Admin')) {
      //       adminId = req.user._id;
      //     } else {
      //       const admin = await User.findOne({
      //         role: 'Admin',
      //         gmailTokens: { $exists: true, $ne: null }
      //       });
      //       if (admin) adminId = admin._id;
      //     }

      //     if (adminId) {
      //       await updateCalendarEvent(adminId.toString(), updatedTask, updatedTask.googleCalendarEventId);
      //       console.log('✅ Calendar event updated for order:', updatedTask.orderNumber);
      //     }
      //   } catch (calendarError) {
      //     if (calendarError.message?.includes('CALENDAR_SCOPE_MISSING') ||
      //       calendarError.message?.includes('INVALID_GRANT')) {
      //       console.error('⚠️ Calendar integration requires re-authentication.');
      //       console.error('💡 Admin should visit: /api/gmail/auth/google?adminId=' + (adminId || 'ADMIN_ID'));
      //     } else {
      //       console.error('❌ Error updating calendar event:', calendarError.message);
      //     }
      //   }
      // }

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

      console.log('=== UPDATE TASK COMPLETE ===');
      res.status(200).json({
        message: 'Task updated successfully',
        task: updatedTask,
      });
    } catch (error) {
      console.error('=== UPDATE TASK ERROR ===');
      console.error('Error:', error);
      res.status(500).json({
        message: 'Failed to update task',
        error: error.message,
      });
    }
  },
  //this api used by driver to mark the task as started or finished
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
        const oldStatus = task.taskStatus;
        task.startDate = now;
        task.taskStatus = 'Processing';
        await task.save();

        // Create a log of the status change
        if (req.user) {
          await loggingService.createLog({
            userId: req.user._id,
            username: req.user.username,
            action: 'UPDATE',
            entityType: 'TASK',
            entityId: taskId,
            changes: {
              before: { taskStatus: oldStatus, startDate: task.startDate },
              after: { taskStatus: task.taskStatus, startDate: now },
            },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
          });
        }

        // Update Google Calendar event if it exists
        if (task.googleCalendarEventId) {
          try {
            let adminId = null;
            if (req.user && req.user.role && req.user.role.includes('Admin')) {
              adminId = req.user._id;
            } else {
              const admin = await User.findOne({
                role: 'Admin',
                gmailTokens: { $exists: true, $ne: null }
              });
              if (admin) adminId = admin._id;
            }

            if (adminId) {
              await updateCalendarEvent(adminId.toString(), task, task.googleCalendarEventId);
              console.log('✅ Calendar event updated for order:', task.orderNumber);
            }
          } catch (calendarError) {
            if (calendarError.message?.includes('CALENDAR_SCOPE_MISSING') ||
              calendarError.message?.includes('INVALID_GRANT')) {
              console.error('⚠️ Calendar integration requires re-authentication.');
              console.error('💡 Admin should visit: /api/gmail/auth/google?adminId=' + (adminId || 'ADMIN_ID'));
            } else {
              console.error('❌ Error updating calendar event:', calendarError.message);
            }
          }
        }

        // Notify all admins that the task has been started (New -> Processing)
        try {
          const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
          const orderNumber = task.orderNumber || task._id;
          const notificationMessage = `Driver ${req.user?.username} has started the task order number #${orderNumber} `;

          for (const admin of adminUsers) {
            if (admin._id) {
              await emitNotificationToUser(
                admin._id.toString(),
                'Orders',
                notificationMessage,
                req.user?.username || null,
              );
            }
          }

        } catch (notificationError) {
          console.error('Error sending start notification to admins:', notificationError);
          // Do not fail the request if notification sending fails
        }

        return res.status(200).json({
          message: 'Task marked as started successfully',
          task,
        });
      }

      if (action === 'mark_finish') {
        const oldStatus = task.taskStatus;
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
        console.log("task.finishDate", task.finishDate)
        const timeElapsed = (now - task.startDate) / 1000;
        console.log("timeElapsed", timeElapsed)
        task.timeSpent = timeElapsed;
        await task.save();

        // Send Waste Transfer Note email after task is successfully completed
        await sendWasteTransferNoteEmail(task._id);

        // Create a log of the status change
        if (req.user) {
          await loggingService.createLog({
            userId: req.user._id,
            username: req.user.username,
            action: 'UPDATE',
            entityType: 'TASK',
            entityId: taskId,
            changes: {
              before: { taskStatus: oldStatus },
              after: { taskStatus: task.taskStatus, finishDate: now, timeSpent: timeElapsed },
            },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
          });
        }

        // Update Google Calendar event if it exists
        if (task.googleCalendarEventId) {
          try {
            let adminId = null;
            if (req.user && req.user.role && req.user.role.includes('Admin')) {
              adminId = req.user._id;
            } else {
              const admin = await User.findOne({
                role: 'Admin',
                gmailTokens: { $exists: true, $ne: null }
              });
              if (admin) adminId = admin._id;
            }

            if (adminId) {
              await updateCalendarEvent(adminId.toString(), task, task.googleCalendarEventId);
              console.log('✅ Calendar event updated for order:', task.orderNumber);
            }
          } catch (calendarError) {
            if (calendarError.message?.includes('CALENDAR_SCOPE_MISSING') ||
              calendarError.message?.includes('INVALID_GRANT')) {
              console.error('⚠️ Calendar integration requires re-authentication.');
              console.error('💡 Admin should visit: /api/gmail/auth/google?adminId=' + (adminId || 'ADMIN_ID'));
            } else {
              console.error('❌ Error updating calendar event:', calendarError.message);
            }
          }
        }

        // Notify all admins that the task has been completed (Processing -> Completed)
        try {
          const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
          const orderNumber = task.orderNumber || task._id;
          const notificationMessage = `Task order number #${orderNumber} has been completed`;

          for (const admin of adminUsers) {
            if (admin._id) {
              await emitNotificationToUser(
                admin._id.toString(),
                'Orders',
                notificationMessage,
                req.user?.username || null,
              );
            }
          }
        } catch (notificationError) {
          console.error('Error sending completion notification to admins:', notificationError);
          // Do not fail the request if notification sending fails
        }

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
    const { paymentType, paymentAmountType } = req.body;

    try {
      const task = await Task.findById(taskId).populate('items.standardItemId');
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      // Retrieve coupon code from task if exists
      let coupon = null;
      let couponDiscount = 0;

      if (task.couponCode) {
        try {
          const couponCodeStr = String(task.couponCode).trim().toUpperCase();
          coupon = await Coupon.findOne({ code: couponCodeStr });

          if (!coupon) {
            // Coupon not found, remove from task
            task.couponCode = null;
            task.couponId = null;
            await task.save();
          } else {
            const validation = coupon.validateCoupon(); // Checks expiration, usage, active status
            if (!validation.valid) {
              // Coupon invalid or expired, remove from task
              task.couponCode = null;
              task.couponId = null;
              await task.save();
            }
          }
        } catch (error) {
          console.error('Error validating coupon:', error);
          // Continue without coupon if validation fails
        }
      }

      // Build breakdown array - ONLY standard items with position fees
      const breakdown = task.items
        .filter((item) => item.standardItemId) // Only process standard items
        .map((item) => {
          const itemQuantity = item.quantity || 1;

          // Calculate base item price (without position fees) multiplied by quantity
          let baseItemPrice = 0;
          let positionFee = 0;

          if (item.price && !isNaN(Number(item.price))) {
            // If item has a custom price, we need to extract the base price
            // For now, we'll use the base price from StandardItem and add position fee separately
            baseItemPrice = Number(item.standardItemId.price); // Use base price from StandardItem
          } else {
            // Use base price from StandardItem
            baseItemPrice = Number(item.standardItemId.price);
          }

          // Calculate position fee (multiplied by quantity)
          if (item.Objectsposition === 'InsideWithDismantling') {
            positionFee = item.standardItemId.insideWithDismantlingPrice;
          } else if (item.Objectsposition === 'Inside') {
            positionFee = item.standardItemId.insidePrice;
          }
          // Outside position has no additional fee

          // Total price for this item: (baseItemPrice * quantity) + (positionFee * quantity)
          const totalItemPrice = (baseItemPrice * itemQuantity) + (positionFee * itemQuantity);

          return {
            itemDescription: item.standardItemId.itemName,
            quantity: itemQuantity,
            price: baseItemPrice,
            totalPrice: totalItemPrice, // Include the total price with position fee
            Objectsposition: item.Objectsposition,
            insidePrice: item.standardItemId.insidePrice,
            insideWithDismantlingPrice: item.standardItemId.insideWithDismantlingPrice,
            positionFee: positionFee,
          };
        });

      // Use calculateTotalPrice to get accurate price with all discounts including coupon
      const itemsForCalculation = task.items.map(item => ({
        standardItemId: item.standardItemId?._id || item.standardItemId,
        quantity: item.quantity || 1,
        Objectsposition: item.Objectsposition || 'Outside',
        price: item.price,
        customPrice: item.customPrice
      }));

      const objectsForCalculation = task.items
        .filter(item => !item.standardItemId)
        .map(item => ({
          object: item.object,
          quantity: item.quantity || 1,
          price: item.price
        }));

      const { totalPrice: calculatedTotalPrice, vat: calculatedVat, couponDiscount: calculatedCouponDiscount } = await calculateTotalPrice({
        items: itemsForCalculation,
        objects: objectsForCalculation,
        customDiscountPercent: task.customDiscountPercent,
        discountType: task.discountType,
        hasDiscount: task.hasDiscount,
        createdByType: task.createdByType,
        available: task.available,
        applyMinFee: task.applyMinFee,
        couponCode: task.couponCode
      });

      let basePrice = breakdown.reduce(
        (sum, item) => sum + item.totalPrice,
        0,
      );
      let finalPrice = basePrice;
      if (
        task.available === 'AnyTime' &&
        task.createdByType === 'public' &&
        task.items.every((i) => i.Objectsposition === 'Outside')
      ) {
        finalPrice *= 0.9;
      }

      // Apply coupon discount if exists
      if (coupon && calculatedCouponDiscount > 0) {
        couponDiscount = calculatedCouponDiscount;
        finalPrice = finalPrice - couponDiscount;
      }

      // Apply minimum price (before VAT) - if under £37.5, make it £37.5
      // When total is under £37.5, the full payment becomes £45 (this is a complete payment, not partial)
      const enforceMinimumPrice = task.createdByType !== 'Admin' || task.applyMinFee === true;
      if (enforceMinimumPrice && finalPrice < 37.5) {
        finalPrice = 37.5;
      }

      const vat = finalPrice * 0.2;
      finalPrice += vat;

      // Prepare fullBreakdown for PayPal
      const fullBreakdown = [
        ...breakdown,
      ];

      // Add coupon discount to breakdown if exists
      if (coupon && couponDiscount > 0) {
        fullBreakdown.push({
          description: `Coupon Discount (${coupon.percentage}% - ${coupon.code})`,
          amount: -couponDiscount.toFixed(2)
        });
      }

      fullBreakdown.push(
        { description: 'VAT (20%)', amount: vat.toFixed(2) },
        { description: 'Final Total Price', amount: finalPrice.toFixed(2) }
      );

      // ✅ Mettre à jour les montants pour les paiements partiels
      let amountToPay;
      let actualPaymentType = paymentAmountType; // Store the actual payment type for metadata

      if (paymentAmountType === 'deposit') {
        amountToPay = 45; // Dépôt de £36

        // Si le total final est £36, c'est un paiement complet, pas un dépôt
        if (finalPrice === 45) {
          actualPaymentType = 'full'; // Override to full payment
          amountToPay = finalPrice; // Use the full price

          // Pour paiement complet, tout sera payé
          task.paidAmount = {
            amount: finalPrice,
            method: 'online',
            status: 'Not_Paid', // Pas encore payé, sera confirmé après paiement
          };
          task.remainingAmount = {
            amount: 0,
            method: 'online',
            status: 'Not_Paid',
          };
          // For public users, keep 'Failed' status until payment succeeds (no 'Unpaid' state)
          // For others, set to 'Unpaid' until confirmation
          task.paymentStatus = task.createdByType === 'public' ? 'Failed' : 'Unpaid';
        } else {
          // Vrai dépôt partiel
          task.paidAmount = {
            amount: 45,
            method: 'online',
            status: 'Not_Paid', // Pas encore payé, sera confirmé après paiement
          };
          task.remainingAmount = {
            amount: finalPrice - 45,
            method: 'online',
            status: 'Not_Paid',
          };
          // For public users, keep 'Failed' status until payment succeeds (no 'Unpaid' state)
          // For others, set to 'Unpaid' until confirmation
          task.paymentStatus = task.createdByType === 'public' ? 'Failed' : 'Unpaid';
        }
      } else {
        amountToPay = finalPrice; // Paiement complet

        // Pour paiement complet, tout sera payé
        task.paidAmount = {
          amount: finalPrice,
          method: 'online',
          status: 'Not_Paid', // Pas encore payé, sera confirmé après paiement
        };
        task.remainingAmount = {
          amount: 0,
          method: 'online',
          status: 'Not_Paid',
        };
        // For public users, keep 'Failed' status until payment succeeds (no 'Unpaid' state)
        // For others, set to 'Unpaid' until confirmation
        task.paymentStatus = task.createdByType === 'public' ? 'Failed' : 'Unpaid';
      }

      const amountInPence = Math.round(amountToPay * 100);

      // Sauvegarder les montants mis à jour
      await task.save();

      // Créer la session de paiement
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
                        'https://res.cloudinary.com/dehzhd6xs/image/upload/v1766479049/Group_1261156242_1_caq0t0.png',
                      ],
                    },
                    unit_amount: amountInPence,
                  },
                  quantity: 1,
                },
              ],
              success_url: `${CLIENT_URL}/payment/success?taskId=${taskId}&paymentAmountType=${paymentAmountType}&paymentType=stripe`,
              cancel_url: `${CLIENT_URL}/payment/failed?taskId=${taskId}&paymentAmountType=${paymentAmountType}&paymentType=stripe`,
              metadata: {
                taskId: taskId,
                paymentAmountType: actualPaymentType,
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
          const paymentResult = await createPayPalOrder(
            amountInPence,
            taskId,
            fullBreakdown,
            task,
            paymentAmountType,
          );
          return res.json({
            message: 'PayPal payment initiated successfully',
            orderID: paymentResult.result.id,
            approvalLink:
              paymentResult.result.links.find((link) => link.rel === 'approve')
                ?.href || null,
            amount: amountInPence,
            paymentType,
            paymentAmountType: actualPaymentType, // Return for frontend tracking
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

        // Store coupon info BEFORE validation (in case validation clears it)
        const storedCouponId = task.couponId;
        const storedCouponCode = task.couponCode;

        // Retrieve coupon code from task if exists and validate it
        if (task.couponCode) {
          try {
            const couponCodeStr = String(task.couponCode).trim().toUpperCase();
            const coupon = await Coupon.findOne({ code: couponCodeStr });

            if (!coupon) {
              // Coupon not found, remove from task
              task.couponCode = null;
              task.couponId = null;
              await task.save();
            } else {
              const validation = coupon.validateCoupon();
              if (!validation.valid) {
                // Coupon invalid or expired, remove from task
                task.couponCode = null;
                task.couponId = null;
                await task.save();
              }
            }
          } catch (error) {
            console.error('Error validating coupon in payment confirmation:', error);
            // Continue without coupon if validation fails
          }
        }

        const amountInCents = paymentIntent.amount;
        const amountInGBP = Number((amountInCents / 100).toFixed(2));

        // Use calculateTotalPrice to get accurate price with coupon if exists
        const itemsForCalculation = task.items.map(item => ({
          standardItemId: item.standardItemId?._id || item.standardItemId,
          quantity: item.quantity || 1,
          Objectsposition: item.Objectsposition || 'Outside',
          price: item.price,
          customPrice: item.customPrice
        }));

        const objectsForCalculation = task.items
          .filter(item => !item.standardItemId)
          .map(item => ({
            object: item.object,
            quantity: item.quantity || 1,
            price: item.price
          }));

        const { totalPrice: calculatedTotalPrice } = await calculateTotalPrice({
          items: itemsForCalculation,
          objects: objectsForCalculation,
          customDiscountPercent: task.customDiscountPercent,
          discountType: task.discountType,
          hasDiscount: task.hasDiscount,
          createdByType: task.createdByType,
          available: task.available,
          applyMinFee: task.applyMinFee,
          couponCode: task.couponCode
        });

        // Recalculer le prix final pour le remainingAmount - ONLY standard items with position fees
        let basePrice = 0;
        task.items
          .filter((item) => item.standardItemId) // Only process standard items
          .forEach((item) => {
            const quantity = item.quantity || 1;
            let itemPrice = 0;

            // Calculate base item price (without position fees) multiplied by quantity
            if (item.price && !isNaN(Number(item.price))) {
              // If item has a custom price, we need to extract the base price
              // For now, we'll use the base price from StandardItem and add position fee separately
              itemPrice = Number(item.standardItemId.price); // Use base price from StandardItem
            } else {
              // Use base price from StandardItem
              itemPrice = Number(item.standardItemId.price);
            }

            // Calculate position fee (multiplied by quantity)
            let positionFee = 0;
            if (item.Objectsposition === 'InsideWithDismantling') {
              positionFee = item.standardItemId.insideWithDismantlingPrice;
            } else if (item.Objectsposition === 'Inside') {
              positionFee = item.standardItemId.insidePrice;
            }
            // Outside position has no additional fee

            basePrice += (itemPrice * quantity) + (positionFee * quantity);
          });

        // Use calculated price which includes coupon discount
        let finalPrice = calculatedTotalPrice;

        // ✅ Mettre à jour le statut de paiement SEULEMENT après confirmation
        // ❌ NE PAS modifier taskStatus - il reste inchangé
        if (amountInGBP === 45 && finalPrice > 45) {
          // Dépôt partiel (seulement si le total final est > £36)
          task.paymentStatus = 'partial_Paid';
          task.paidAmount = {
            amount: 45,
            method: 'online',
            status: 'Paid',
          };
          task.remainingAmount = {
            amount: finalPrice - 45, // Utiliser finalPrice calculé
            method: 'online',
            status: 'Not_Paid', // ✅ Reste à payer
          };
        } else {
          // Paiement complet (y compris quand amountInGBP === 36 et finalPrice === 36)
          task.paymentStatus = 'Paid';
          task.paidAmount = {
            amount: amountInGBP,
            method: 'online',
            status: 'Paid',
          };
          task.remainingAmount = {
            amount: 0,
            method: 'online',
            status: 'Paid',
          };
        }

        // Increment coupon usage ONCE after successful Stripe payment confirmation
        // Use stored coupon values (before validation might have cleared them)
        if (storedCouponId && storedCouponCode && task.couponUsageIncremented !== true) {
          try {
            const coupon = await Coupon.findById(storedCouponId);
            if (coupon) {
              const usageBefore = coupon.usageCount;
              await coupon.incrementUsage();
              // Refetch coupon to get updated usageCount
              const updatedCoupon = await Coupon.findById(storedCouponId);
              task.couponUsageIncremented = true;
              console.log(`✅ Coupon "${storedCouponCode}" usage incremented after Stripe payment: ${usageBefore} → ${updatedCoupon.usageCount}`);
            }
          } catch (error) {
            console.error('Error incrementing coupon usage after Stripe payment:', error);
            // Don't fail payment confirmation if increment fails
          }
        }

        await task.save(); // ✅ Sauvegarder SEULEMENT après confirmation

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

        // Construire le breakdown complet - ONLY standard items
        const breakdown = task.items
          .filter((item) => item.standardItemId) // Only process standard items
          .map((item) => {
            let itemPrice = 0;
            // Use the price from the item if available, otherwise use position-specific prices
            if (item.price && !isNaN(Number(item.price))) {
              itemPrice = Number(item.price);
            } else {
              // Fallback to position-specific prices from StandardItem
              if (item.Objectsposition === 'InsideWithDismantling') {
                itemPrice = item.standardItemId.insideWithDismantlingPrice;
              } else if (item.Objectsposition === 'Inside') {
                itemPrice = item.standardItemId.insidePrice;
              } else {
                itemPrice = item.standardItemId.price;
              }
            }

            return {
              itemDescription: item.standardItemId.itemName,
              quantity: item.quantity || 1,
              price: itemPrice,
            };
          });

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
          amount: amountInGBP,
          paymentType: 'Stripe',
          paymentDate: new Date(),
          transactionId: paymentIntentId,
          payerAccount,
          status: 'success',
          statusMessage: `Payment successful via Stripe. Transaction ID: ${paymentIntentId}. Amount: £${amountInGBP.toFixed(2)}.`,
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

        // Send notification to admins only
        const notificationMessage = `Payment confirmed for task #${task.orderNumber || taskId}`;
        const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
        for (const admin of adminUsers) {
          if (admin._id) {
            await emitNotificationToUser(admin._id.toString(), 'Orders', notificationMessage);
          }
        }

        await task.save();
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

      // If Stripe returns a card_error (e.g. card_declined), send a failed-payment email
      try {
        const task = await Task.findById(taskId);
        if (task) {
          await sendPaymentFailedEmail({
            email: task.email,
            firstName: task.firstName,
            lastName: task.lastName,
            orderId: String(task._id),
            amount: undefined, // we don't have a confirmed charge amount here
            currency: 'GBP',
            paymentType: 'Stripe',
            reason: error?.message || 'Card was declined',
          });
        }
      } catch (emailErr) {
        console.error('Error sending Stripe failed-payment email (confirmStripeTaskPayment):', emailErr);
      }

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

      // Store coupon info BEFORE validation (in case validation clears it)
      const storedCouponId = task.couponId;
      const storedCouponCode = task.couponCode;

      // Retrieve coupon code from task if exists and validate it
      if (task.couponCode) {
        try {
          const couponCodeStr = String(task.couponCode).trim().toUpperCase();
          const coupon = await Coupon.findOne({ code: couponCodeStr });

          if (!coupon) {
            // Coupon not found, remove from task
            task.couponCode = null;
            task.couponId = null;
            await task.save();
          } else {
            const validation = coupon.validateCoupon();
            if (!validation.valid) {
              // Coupon invalid or expired, remove from task
              task.couponCode = null;
              task.couponId = null;
              await task.save();
            }
          }
        } catch (error) {
          console.error('Error validating coupon in PayPal payment capture:', error);
          // Continue without coupon if validation fails
        }
      }

      const request = new paypal.orders.OrdersCaptureRequest(orderID);
      request.requestBody({});

      const capture = await PayPalClient().execute(request);

      if (capture.result.status === 'COMPLETED') {
        const amountInGBP = parseFloat(
          capture.result.purchase_units[0].payments.captures[0].amount.value,
        );

        // Use calculateTotalPrice to get accurate price with coupon if exists
        const itemsForCalculation = task.items.map(item => ({
          standardItemId: item.standardItemId?._id || item.standardItemId,
          quantity: item.quantity || 1,
          Objectsposition: item.Objectsposition || 'Outside',
          price: item.price,
          customPrice: item.customPrice
        }));

        const objectsForCalculation = task.items
          .filter(item => !item.standardItemId)
          .map(item => ({
            object: item.object,
            quantity: item.quantity || 1,
            price: item.price
          }));

        const { totalPrice: calculatedTotalPrice } = await calculateTotalPrice({
          items: itemsForCalculation,
          objects: objectsForCalculation,
          customDiscountPercent: task.customDiscountPercent,
          discountType: task.discountType,
          hasDiscount: task.hasDiscount,
          createdByType: task.createdByType,
          available: task.available,
          applyMinFee: task.applyMinFee,
          couponCode: task.couponCode
        });

        // Use calculated price which includes coupon discount
        let finalPrice = calculatedTotalPrice;

        // ✅ Mettre à jour le statut de paiement SEULEMENT après confirmation
        // ❌ NE PAS modifier taskStatus - il reste inchangé
        if (amountInGBP === 45) {
          // Dépôt partiel
          task.paymentStatus = 'partial_Paid';
          task.paidAmount = {
            amount: 45,
            method: 'online',
            status: 'Paid',
          };
          task.remainingAmount = {
            amount: finalPrice - 45, // Utiliser finalPrice calculé
            method: 'online',
            status: 'Not_Paid', // ✅ Reste à payer
          };
        } else {
          // Paiement complet
          task.paymentStatus = 'Paid';
          task.paidAmount = {
            amount: amountInGBP,
            method: 'online',
            status: 'Paid',
          };
          task.remainingAmount = {
            amount: 0,
            method: 'online',
            status: 'Paid',
          };
        }

        // Increment coupon usage ONCE after successful PayPal payment capture
        // Use stored coupon values (before validation might have cleared them)
        if (storedCouponId && storedCouponCode && task.couponUsageIncremented !== true) {
          try {
            const coupon = await Coupon.findById(storedCouponId);
            if (coupon) {
              const usageBefore = coupon.usageCount;
              await coupon.incrementUsage();
              // Refetch coupon to get updated usageCount
              const updatedCoupon = await Coupon.findById(storedCouponId);
              task.couponUsageIncremented = true;
              console.log(`✅ Coupon "${storedCouponCode}" usage incremented after PayPal payment: ${usageBefore} → ${updatedCoupon.usageCount}`);
            }
          } catch (error) {
            console.error('Error incrementing coupon usage after PayPal payment:', error);
            // Don't fail payment capture if increment fails
          }
        }

        await task.save();
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
          amount: amountInGBP,
          paymentType: 'PayPal',
          paymentDate: new Date(),
          transactionId,
          payerAccount,
          status: 'success',
          statusMessage: `Payment successful via PayPal. Transaction ID: ${transactionId}. Amount: £${amountInGBP.toFixed(2)}.`,
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

        // Send notification to admins only
        const notificationMessage = `Payment confirmed for task #${task.orderNumber || taskId}`;
        const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
        for (const admin of adminUsers) {
          if (admin._id) {
            await emitNotificationToUser(admin._id.toString(), 'Orders', notificationMessage);
          }
        }

        return res.status(200).json({
          message: 'PayPal payment captured successfully and email sent',
          task,
        });
      } else {
        // Capture did not complete successfully – send failed-payment email
        try {
          await sendPaymentFailedEmail({
            email: task.email,
            firstName: task.firstName,
            lastName: task.lastName,
            orderId: String(task._id),
            amount: undefined,
            currency: 'GBP',
            paymentType: 'PayPal',
            reason: `PayPal capture status: ${capture.result.status}`,
          });
        } catch (emailErr) {
          console.error('Error sending PayPal failed-payment email (capturePayPalTaskPayment else):', emailErr);
        }

        return res
          .status(400)
          .json({ message: 'Failed to capture payment', capture });
      }
    } catch (error) {
      console.error('Error capturing PayPal payment:', error);
      // If capture throws (e.g. denied), send failed-payment email
      try {
        const task = await Task.findById(taskId);
        if (task) {
          await sendPaymentFailedEmail({
            email: task.email,
            firstName: task.firstName,
            lastName: task.lastName,
            orderId: String(task._id),
            amount: undefined,
            currency: 'GBP',
            paymentType: 'PayPal',
            reason: error.message || 'PayPal capture failed',
          });
        }
      } catch (emailErr) {
        console.error('Error sending PayPal failed-payment email (capturePayPalTaskPayment catch):', emailErr);
      }

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

      // Retrieve coupon code from task if exists
      let coupon = null;

      if (task.couponCode) {
        try {
          const couponCodeStr = String(task.couponCode).trim().toUpperCase();
          coupon = await Coupon.findOne({ code: couponCodeStr });

          if (!coupon) {
            // Coupon not found, remove from task
            task.couponCode = null;
            task.couponId = null;
            await task.save();
          } else {
            const validation = coupon.validateCoupon(); // Checks expiration, usage, active status
            if (!validation.valid) {
              // Coupon expired or invalid, remove from task
              task.couponCode = null;
              task.couponId = null;
              await task.save();
            } else {
              // Coupon is valid, ensure couponId is set
              task.couponId = coupon._id;
              await task.save();
            }
          }
        } catch (error) {
          console.error('Error validating coupon:', error);
          // Continue without coupon if validation fails
        }
      }

      // Calculate total price and breakdown first (will include coupon discount)
      // amountToPay will be calculated after we know the final totalPrice
      let subtotal = 0;
      const breakdown = [];

      // Calculate subtotal with discount handling
      for (const item of task.items) {
        let itemPrice = 0;
        let itemDescription = '';
        let positionFee = 0; // Declare positionFee at the proper scope

        if (item.standardItemId) {
          // Base item price (outside position)
          itemPrice = Number(item.standardItemId.price);
          itemDescription = item.standardItemId.itemName;

          // Position fee (multiplied by quantity)
          if (item.Objectsposition === 'InsideWithDismantling') {
            positionFee = Number(item.standardItemId.insideWithDismantlingPrice);
          } else if (item.Objectsposition === 'Inside') {
            positionFee = Number(item.standardItemId.insidePrice);
          }
        } else if (item.object) {
          itemPrice = Number(item.price);
          itemDescription = item.object;
        }

        const quantity = Number(item.quantity) || 1;

        // Calculate total: (itemPrice * quantity) + (positionFee * quantity)
        let finalItemTotal;
        let displayPrice = itemPrice;

        if (item.standardItemId) {
          // For standard items: (itemPrice * quantity) + (positionFee * quantity)
          finalItemTotal = (itemPrice * quantity) + (positionFee * quantity);
        } else {
          // For custom items: itemPrice * quantity (no position fee)
          finalItemTotal = itemPrice * quantity;
        }

        // Per-item discount logic: use customPrice if present
        if (
          task.hasDiscount &&
          task.discountType === 'perItem' &&
          item.customPrice
        ) {
          displayPrice = Number(item.customPrice);
          if (item.standardItemId) {
            // For standard items with discount: (customPrice * quantity) + (positionFee * quantity)
            finalItemTotal = (Number(item.customPrice) * quantity) + (positionFee * quantity);
          } else {
            // For custom items with discount: customPrice * quantity
            finalItemTotal = Number(item.customPrice) * quantity;
          }
        }

        breakdown.push({
          itemDescription,
          quantity,
          price: displayPrice,
          total: finalItemTotal,
          Objectsposition: item.Objectsposition,
          standardItemId: item.standardItemId,
          insidePrice: item.standardItemId?.insidePrice,
          insideWithDismantlingPrice: item.standardItemId?.insideWithDismantlingPrice,
          positionFee: positionFee,
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

      // Apply 10% discount if task is created by public, all items are 'Outside', and available === 'AnyTime'
      const isAvailableAnyTime = task.available === 'AnyTime';
      const isCreatedByPublic = task.createdByType === 'public';
      const hasItems = task.items && task.items.length > 0;
      const allItemsOutside = hasItems && task.items.every((i) => i.Objectsposition === 'Outside');

      if (isAvailableAnyTime && isCreatedByPublic && hasItems && allItemsOutside) {
        subtotal *= 0.9;
      }

      // Apply coupon discount if exists
      let couponDiscount = 0;
      if (coupon) {
        // Use calculateTotalPrice to get accurate coupon discount
        const itemsForCalculation = task.items.map(item => ({
          standardItemId: item.standardItemId?._id || item.standardItemId,
          quantity: item.quantity || 1,
          Objectsposition: item.Objectsposition || 'Outside',
          price: item.price,
          customPrice: item.customPrice
        }));

        const objectsForCalculation = task.items
          .filter(item => !item.standardItemId)
          .map(item => ({
            object: item.object,
            quantity: item.quantity || 1,
            price: item.price
          }));

        const { couponDiscount: calculatedCouponDiscount } = await calculateTotalPrice({
          items: itemsForCalculation,
          objects: objectsForCalculation,
          customDiscountPercent: task.customDiscountPercent,
          discountType: task.discountType,
          hasDiscount: task.hasDiscount,
          createdByType: task.createdByType,
          available: task.available,
          applyMinFee: task.applyMinFee,
          couponCode: task.couponCode
        });

        couponDiscount = calculatedCouponDiscount;
        if (couponDiscount > 0) {
          subtotal -= couponDiscount;
          breakdown.push({
            description: `Coupon Discount (${coupon.percentage}% - ${coupon.code})`,
            amount: -couponDiscount,
          });
        }
      }

      // Enforce minimum price (before VAT) if needed
      const enforceMinimumPrice = task.createdByType !== 'Admin' || task.applyMinFee === true;
      if (enforceMinimumPrice && subtotal < 37.5) {
        const adjustment = 37.5 - subtotal;
        subtotal = 37.5;
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

      // Now calculate amountToPay based on paymentType and totalPrice (which includes coupon discount)
      let amountToPay;
      if (paymentType === 'deposit') {
        let requestedDeposit = task.paidAmount?.amount || 0;
        amountToPay = requestedDeposit;

        task.paidAmount = {
          amount: amountToPay,
          method: 'payment_link',
          status: 'Not_Paid',
        };
        task.remainingAmount = {
          amount: totalPrice - amountToPay,
          status: 'Not_Paid',
          method: 'cash',
        };
        // Reflect partial payment intent on the task
        task.paymentStatus = 'partial_Paid';
        await task.save();

      } else if (paymentType === 'remaining') {
        amountToPay = task.remainingAmount?.amount || (totalPrice - (task.paidAmount?.amount || 0));

        task.remainingAmount = {
          amount: amountToPay,
          status: 'Not_Paid',
          method: 'payment_link'
        }
        task.paymentMethod = 'payment_link';

        await task.save();
      } else {
        amountToPay = totalPrice;
        await task.save();
      }

      if (!amountToPay || amountToPay <= 0) {
        return res
          .status(400)
          .json({ message: 'No amount to pay for this payment type.' });
      }

      // Debug log to confirm amountToPay and paymentType
      console.log(
        'amountToPay for payment link:',
        amountToPay,
        'paymentType:',
        paymentType,
        'totalPrice (with coupon):',
        totalPrice,
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
          // ❌ NE PAS modifier taskStatus - il reste inchangé
        }

        // Increment coupon usage ONCE after successful Stripe webhook payment
        if (task.couponCode && task.couponUsageIncremented !== true) {
          try {
            // Try to find coupon by ID first, then by code if ID is missing
            let coupon = null;
            if (task.couponId) {
              coupon = await Coupon.findById(task.couponId);
            }

            // If coupon not found by ID, try to find by code
            if (!coupon && task.couponCode) {
              const couponCodeStr = String(task.couponCode).trim().toUpperCase();
              coupon = await Coupon.findOne({ code: couponCodeStr });
              // Update task with couponId if found
              if (coupon) {
                task.couponId = coupon._id;
              }
            }

            if (coupon) {
              const usageBefore = coupon.usageCount;
              await coupon.incrementUsage();
              // Refetch coupon to get updated usageCount
              const updatedCoupon = await Coupon.findById(coupon._id);
              task.couponUsageIncremented = true;
              console.log(`✅ Coupon "${task.couponCode}" usage incremented after Stripe webhook payment: ${usageBefore} → ${updatedCoupon.usageCount}`);
            } else {
              console.warn(`⚠️ Coupon not found for code "${task.couponCode}" in Stripe webhook`);
            }
          } catch (error) {
            console.error('Error incrementing coupon usage after Stripe webhook payment:', error);
            // Don't fail webhook if increment fails
          }
        }

        const amountInCents = session.amount_total;
        const amountInGBP = amountInCents / 100;
        
        // Get the actual Payment Intent ID or Charge ID (not Checkout Session ID)
        let transactionId = session.payment_intent; // Payment Intent ID (pi_xxx)
        let payerAccount = task.email;

        // If payment_intent exists, try to get the Charge ID (ch_xxx) which is the actual transaction ID
        if (transactionId && transactionId.startsWith('pi_')) {
          try {
            const paymentIntent = await stripe.paymentIntents.retrieve(transactionId);
            // Get the charge ID from the latest charge
            if (paymentIntent.latest_charge) {
              // latest_charge can be a string ID or a Charge object
              const chargeId = typeof paymentIntent.latest_charge === 'string' 
                ? paymentIntent.latest_charge 
                : paymentIntent.latest_charge.id;
              transactionId = chargeId; // Use Charge ID (ch_xxx) as the actual transaction ID
              
              // Also get the payer account from the charge if available
              if (paymentIntent.charges?.data?.[0]?.billing_details?.email) {
                payerAccount = paymentIntent.charges.data[0].billing_details.email;
              }
            }
          } catch (error) {
            console.error('Error retrieving Payment Intent:', error);
            // Fall back to Payment Intent ID if we can't get the Charge ID
            // transactionId already set to session.payment_intent
          }
        } else if (!transactionId) {
          // Fallback: if no payment_intent, use session ID but log a warning
          console.warn('No payment_intent found in checkout session, using session ID as fallback');
          transactionId = session.id; // This would be cs_xxx, not ideal but better than nothing
        }

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
          transactionId: transactionId, // Now uses Charge ID (ch_xxx) when available
          payerAccount,
          status: 'success',
          statusMessage: `Payment successful via Stripe. Transaction ID: ${transactionId}. Amount: £${amountInGBP.toFixed(2)}. Payment type: ${paymentAmountType === 'deposit' ? 'Deposit' : paymentAmountType === 'remaining' ? 'Remaining' : 'Full payment'}.`,
        });

        // Construire le breakdown complet pour l'email
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
          { description: 'Payment Method', amount: payerAccount },
        );

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

        // Send notification to admins only
        const notificationMessage = `Payment confirmed for task #${task.orderNumber || taskId}`;
        const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
        for (const admin of adminUsers) {
          if (admin._id) {
            await emitNotificationToUser(admin._id.toString(), 'Orders', notificationMessage);
          }
        }

        res.status(200).send('Webhook received');
      } else if (
        event.type === 'checkout.session.async_payment_failed' ||
        event.type === 'checkout.session.expired' ||
        event.type === 'payment_intent.payment_failed'
      ) {
        // Handle payment failures
        try {
          let taskId = null;
          let amountInCents = null;
          let failureReason = null;
          let customerEmail = null;
          let paymentIntentId = null;

          if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
            const session = event.data.object;
            taskId = session.metadata && session.metadata.taskId;
            amountInCents = session.amount_total || null;
            customerEmail = session.customer_details && session.customer_details.email;
            paymentIntentId = session.payment_intent; // Don't fallback to session.id for failed payments
            // If payment_intent is missing, log a warning but still process the failure
            if (!paymentIntentId) {
              console.warn('No payment_intent in failed checkout session, using session ID');
              paymentIntentId = session.id;
            }
            if (event.type === 'checkout.session.async_payment_failed') {
              failureReason = session.last_payment_error
                ? session.last_payment_error.message
                : 'Payment failed during checkout';
            } else {
              failureReason = 'Checkout session expired';
            }
          } else if (event.type === 'payment_intent.payment_failed') {
            const intent = event.data.object;
            paymentIntentId = intent.id;
            amountInCents = intent.amount || null;
            failureReason = intent.last_payment_error && intent.last_payment_error.message;
            // taskId is usually in metadata if you set it when creating the intent
            taskId = intent.metadata && intent.metadata.taskId;
            customerEmail = intent.receipt_email || undefined;
          }

          if (!taskId) {
            console.warn('Stripe failed payment webhook without taskId metadata, skipping email.');
            return res.status(200).send('Ignored – no taskId');
          }

          const task = await Task.findById(taskId);
          if (!task) {
            console.warn(`Stripe failed payment webhook: task not found for ID ${taskId}`);
            return res.status(200).send('Ignored – task not found');
          }

          const amountInGBP = amountInCents != null ? amountInCents / 100 : null;

          // Create PaymentHistory entry for failed payment
          await PaymentHistory.create({
            taskId: task._id,
            firstName: task.firstName,
            lastName: task.lastName,
            phoneNumber: task.phoneNumber,
            amount: amountInGBP != null ? amountInGBP : 0,
            paymentType: 'Stripe',
            paymentDate: new Date(),
            transactionId: paymentIntentId || 'failed',
            payerAccount: task.email || customerEmail,
            status: 'failed',
            errorMessage: failureReason || `Stripe payment failed. Event type: ${event.type}`,
          });

          // Send payment failed email
          await sendPaymentFailedEmail({
            email: task.email || customerEmail,
            firstName: task.firstName,
            lastName: task.lastName,
            orderId: String(task._id),
            amount: amountInGBP != null ? amountInGBP : undefined,
            currency: 'GBP',
            paymentType: 'Stripe',
            reason: failureReason || `Stripe event type: ${event.type}`,
          });

          console.log(`Payment failed email sent for task ${taskId}, event: ${event.type}`);
          return res.status(200).send('Failed payment handled');
        } catch (innerErr) {
          console.error('Error handling Stripe failed payment webhook:', innerErr);
          // Do not fail webhook – just acknowledge
          return res.status(200).send('Failed payment handling error (logged)');
        }
      } else {
        // Log other events but don't process them
        console.log(`Unhandled Stripe webhook event type: ${event.type}`);
        return res.status(200).send('Event ignored');
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
            // ❌ NE PAS modifier taskStatus - il reste inchangé
            task.paidAmount = task.paidAmount || {};
            task.remainingAmount = task.remainingAmount || {};
            task.paidAmount.status = 'Paid';
            task.remainingAmount.status = 'Paid';
          }

          // Increment coupon usage ONCE after successful PayPal webhook payment
          if (task.couponId && task.couponCode && task.couponUsageIncremented !== true) {
            try {
              const coupon = await Coupon.findById(task.couponId);
              if (coupon) {
                const usageBefore = coupon.usageCount;
                await coupon.incrementUsage();
                // Refetch coupon to get updated usageCount
                const updatedCoupon = await Coupon.findById(task.couponId);
                task.couponUsageIncremented = true;
                console.log(`✅ Coupon "${task.couponCode}" usage incremented after PayPal webhook payment: ${usageBefore} → ${updatedCoupon.usageCount}`);
              }
            } catch (error) {
              console.error('Error incrementing coupon usage after PayPal webhook payment:', error);
              // Don't fail webhook if increment fails
            }
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
            status: 'success',
            statusMessage: `Payment successful via PayPal. Transaction ID: ${cap.id}. Amount: ${cap.amount.currency_code} ${cap.amount.value}. Payment type: ${paymentTypeMeta === 'deposit' ? 'Deposit' : paymentTypeMeta === 'remaining' ? 'Remaining' : 'Full payment'}.`,
          });

          // fire-and-forget the email (don't block webhook)
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
            // ❌ NE PAS modifier taskStatus - il reste inchangé
            task.paidAmount.status = 'Paid';
            task.remainingAmount.status = 'Paid';
          }

          // Increment coupon usage ONCE after successful PayPal webhook payment (PAYMENT.CAPTURE.COMPLETED)
          if (task.couponCode && task.couponUsageIncremented !== true) {
            try {
              // Try to find coupon by ID first, then by code if ID is missing
              let coupon = null;
              if (task.couponId) {
                coupon = await Coupon.findById(task.couponId);
              }

              // If coupon not found by ID, try to find by code
              if (!coupon && task.couponCode) {
                const couponCodeStr = String(task.couponCode).trim().toUpperCase();
                coupon = await Coupon.findOne({ code: couponCodeStr });
                // Update task with couponId if found
                if (coupon) {
                  task.couponId = coupon._id;
                }
              }

              if (coupon) {
                const usageBefore = coupon.usageCount;
                await coupon.incrementUsage();
                // Refetch coupon to get updated usageCount
                const updatedCoupon = await Coupon.findById(coupon._id);
                task.couponUsageIncremented = true;
                console.log(`✅ Coupon "${task.couponCode}" usage incremented after PayPal webhook payment (CAPTURE.COMPLETED): ${usageBefore} → ${updatedCoupon.usageCount}`);
              } else {
                console.warn(`⚠️ Coupon not found for code "${task.couponCode}" in PayPal webhook`);
              }
            } catch (error) {
              console.error('Error incrementing coupon usage after PayPal webhook payment:', error);
              // Don't fail webhook if increment fails
            }
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
            status: 'success',
            statusMessage: `Payment captured successfully via PayPal. Transaction ID: ${capture.id}. Amount: ${capture.amount.currency_code} ${capture.amount.value}. Payment type: ${paymentTypeMeta === 'deposit' ? 'Deposit' : paymentTypeMeta === 'remaining' ? 'Remaining' : 'Full payment'}.`,
          });

          // Send notification to admins only
          const notificationMessage = `Payment confirmed for task #${task.orderNumber || task._id}`;
          const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
          for (const admin of adminUsers) {
            if (admin._id) {
              await emitNotificationToUser(admin._id.toString(), 'Orders', notificationMessage);
            }
          }

          // (optional) send email async as above…
          return res.status(200).send('Processed');
        }

        // Handle failed/denied PayPal captures – send failed-payment email only
        case 'PAYMENT.CAPTURE.DENIED':
        case 'PAYMENT.CAPTURE.REVERSED': {
          try {
            const capture = evt.resource;
            const orderId = capture?.supplementary_data?.related_ids?.order_id;
            if (!orderId) return res.status(200).send('Ignored – no order id');

            const client = PayPalClient();
            const getReq = new paypal.orders.OrdersGetRequest(orderId);
            const getRes = await client.execute(getReq);
            const pu = getRes.result.purchase_units?.[0];
            const customIdRaw = pu?.custom_id;
            const [customId] = (customIdRaw || '').split('|');
            const payerEmail = getRes.result.payer?.email_address;

            if (!customId) return res.status(200).send('Ignored – no custom_id');

            const task = await Task.findById(customId);
            if (!task) return res.status(200).send('Ignored – task not found');

            const amountValue = capture?.amount?.value;
            const currencyCode = capture?.amount?.currency_code || 'GBP';
            const failureReason =
              capture?.status_details?.reason ||
              capture?.reason ||
              `PayPal event type: ${evt.event_type}`;

            // Create PaymentHistory entry for failed payment
            await PaymentHistory.create({
              taskId: task._id,
              firstName: task.firstName,
              lastName: task.lastName,
              phoneNumber: task.phoneNumber,
              amount: amountValue != null ? Number(amountValue) : 0,
              currency: currencyCode,
              paymentType: 'PayPal',
              paymentDate: new Date(),
              transactionId: capture?.id || 'failed',
              payerAccount: payerEmail || task.email,
              status: 'failed',
              errorMessage: failureReason || `PayPal payment ${evt.event_type}`,
            });

            await sendPaymentFailedEmail({
              email: task.email || payerEmail,
              firstName: task.firstName,
              lastName: task.lastName,
              orderId: String(task._id),
              amount: amountValue != null ? Number(amountValue) : undefined,
              currency: currencyCode,
              paymentType: 'PayPal',
              reason: failureReason,
            });

            return res.status(200).send('PayPal failed payment handled');
          } catch (err) {
            console.error('Error handling PayPal failed payment webhook:', err);
            return res.status(200).send('PayPal failed payment handling error (logged)');
          }
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

      // Check if task is refunded or partially refunded
      const isRefunded = task.paymentStatus === 'refunded' || task.paymentStatus === 'partial_Refunded';

      // Calculate total refunded amount from PaymentHistory
      const PaymentHistory = require('../models/PaymentHistory');
      let totalRefundedAmount = 0;
      let refundInfo = null;

      if (isRefunded) {
        const paymentHistories = await PaymentHistory.find({ taskId: task._id });
        totalRefundedAmount = paymentHistories.reduce((sum, ph) => {
          return sum + (ph.refundedTotalGBP || 0);
        }, 0);

        const isFullRefund = task.paymentStatus === 'refunded';
        refundInfo = {
          isRefund: true,
          refundAmount: totalRefundedAmount,
          isFullRefund: isFullRefund
        };
      }

      // Ensure directory exists
      const dirPath = path.join(__dirname, '../generated');
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);

      const fileName = `invoice-${task.orderNumber}.pdf`;
      const filePath = path.join(dirPath, fileName);

      // Generate the official invoice PDF with refund info if applicable
      await generateOfficialInvoicePDF(task, filePath, refundInfo);

      // Email content in branded design
      const depositAmount = task.paidAmount?.amount || 0;
      const remainingAmount = task.remainingAmount?.amount || (task.totalPrice - depositAmount);
      const isPartialPaid = task.paymentStatus === 'partial_Paid';

      // Get payment method from PaymentHistory or task
      const latestPayment = await PaymentHistory.findOne({ taskId: task._id })
        .sort({ paymentDate: -1 });
      const paymentMethod = latestPayment?.paymentType || task.paidAmount?.method || task.paymentMethod || 'Online Payment';
      const subtotalBeforeDiscount = task.totalPrice;

      // Calculate item discount total for perItem discounts
      let itemDiscountTotal = 0;
      let originalSubtotalBeforePerItemDiscounts = 0; // Track original subtotal before per-item discounts

      // Calculate subtotal and handle discounts based on discountType
      task.items.forEach((item) => {
        let itemPrice = 0;
        let positionFee = 0; // Declare positionFee at the proper scope

        if (item.standardItemId) {
          // Base item price (outside position)
          itemPrice = Number(item.standardItemId.price);

          // Position fee (multiplied by quantity)
          if (item.Objectsposition === 'InsideWithDismantling') {
            positionFee = Number(item.standardItemId.insideWithDismantlingPrice);
          } else if (item.Objectsposition === 'Inside') {
            positionFee = Number(item.standardItemId.insidePrice);
          }
        } else {
          // Custom items use their own price
          itemPrice = Number(item.price);
        }

        const quantity = Number(item.quantity) || 1;

        // Calculate total: (itemPrice * quantity) + (positionFee * quantity)
        let finalItemTotal;
        let originalItemTotal;

        if (item.standardItemId) {
          // For standard items: (itemPrice * quantity) + (positionFee * quantity)
          originalItemTotal = (itemPrice * quantity) + (positionFee * quantity);
          finalItemTotal = originalItemTotal;
        } else {
          // For custom items: itemPrice * quantity (no position fee)
          originalItemTotal = itemPrice * quantity;
          finalItemTotal = originalItemTotal;
        }

        // Track original subtotal BEFORE per-item discounts
        originalSubtotalBeforePerItemDiscounts += originalItemTotal;

        // Handle item-specific discount only if hasDiscount is true and discountType is "perItem"
        if (
          task.hasDiscount &&
          task.discountType === 'perItem' &&
          item.customPrice
        ) {
          let customPrice = Number(item.customPrice);

          if (item.standardItemId) {
            // For standard items with discount: (customPrice * quantity) + (positionFee * quantity)
            finalItemTotal = (customPrice * quantity) + (positionFee * quantity);
            // Calculate discount: (originalPrice - customPrice) * quantity
            itemDiscountTotal += (itemPrice - customPrice) * quantity;
          } else {
            // For custom items with discount: customPrice * quantity
            finalItemTotal = customPrice * quantity;
            // Calculate discount: (originalPrice - customPrice) * quantity
            itemDiscountTotal += (itemPrice - customPrice) * quantity;
          }
        }

        subtotal += finalItemTotal;
        console.log(
          'Invoice Item:',
          item.standardItemId?.itemName || item.object,
          'Base Price:',
          itemPrice,
          'Position Fee:',
          positionFee,
          'Quantity:',
          quantity,
          'FinalItemTotal:',
          finalItemTotal,
          'Formula:',
          item.standardItemId ? `(${itemPrice} × ${quantity}) + (${positionFee} × ${quantity}) = ${finalItemTotal}` : `${itemPrice} × ${quantity} = ${finalItemTotal}`
        );
      });

      // Capture subtotal before any percentage discount, 10% discount, or minimum price adjustments
      // For per-item discounts, use the original subtotal before per-item discounts were applied
      // For other cases, use the current subtotal
      const subtotalBeforeDiscounts = (task.hasDiscount && task.discountType === 'perItem')
        ? originalSubtotalBeforePerItemDiscounts
        : subtotal;

      // Calculate 10% discount if task is created by public, all items are 'Outside', and available === 'AnyTime'
      const isAvailableAnyTime = task.available === 'AnyTime';
      const isCreatedByPublic = task.createdByType === 'public';
      const hasItems = task.items && task.items.length > 0;
      const allItemsOutside = hasItems && task.items.every((i) => i.Objectsposition === 'Outside');

      let automaticDiscount10Percent = 0;
      if (isAvailableAnyTime && isCreatedByPublic && hasItems && allItemsOutside) {
        console.log('✅ Applying 10% discount for Outside items with AnyTime and public type in invoice email');
        automaticDiscount10Percent = subtotal * 0.1;
        subtotal *= 0.9;
      }

      // Handle percentage discount on total only if hasDiscount is true and discountType is "percentage"
      // Note: Percentage discount is calculated AFTER the 10% automatic discount is applied
      if (
        task.hasDiscount &&
        task.discountType === 'percentage' &&
        task.customDiscountPercent > 0
      ) {
        percentageDiscount = (subtotal * task.customDiscountPercent) / 100;
      }

      // Handle coupon discount if exists
      let couponDiscount = 0;
      let couponCode = null;
      let couponPercentage = 0;
      if (task.couponCode) {
        try {
          // Normalize coupon code to uppercase to match Coupon model storage
          const normalizedCouponCode = String(task.couponCode).trim().toUpperCase();
          const coupon = await Coupon.findOne({ code: normalizedCouponCode });
          if (coupon) {
            couponCode = coupon.code;
            couponPercentage = coupon.percentage;
            // Calculate coupon discount on subtotal after other discounts
            couponDiscount = (subtotal * couponPercentage) / 100;
            subtotal -= couponDiscount;
          } else {
            console.warn(`Coupon code "${normalizedCouponCode}" not found in database for task ${task.orderNumber}`);
          }
        } catch (error) {
          console.error('Error fetching coupon for invoice:', error);
        }
      }

      // Apply minimum price (before VAT) - if under £37.5, make it £37.5
      // When total is under £37.5, the full payment becomes £45 (this is a complete payment, not partial)
      // Skip minimum price enforcement if created by Admin, UNLESS applyMinFee is true
      const enforceMinimumPrice = task.createdByType !== 'Admin' || task.applyMinFee === true;
      if (enforceMinimumPrice && subtotal < 37.5) {
        subtotal = 37.5;
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
        hasDiscount: task.hasDiscount && (task.customDiscountPercent > 0 || task.discountType === 'perItem'),
        hasAutomaticDiscount: automaticDiscount10Percent > 0,
        automaticDiscountAmount: automaticDiscount10Percent.toFixed(2),
        isPerItemDiscount: task.hasDiscount && task.discountType === 'perItem',
        discountType: task.discountType || 'percentage',
        customDiscountPercent: task.customDiscountPercent,
        discountAmount: percentageDiscount.toFixed(2),
        itemDiscountAmount: itemDiscountTotal.toFixed(2),
        hasCoupon: couponCode && couponDiscount > 0,
        couponCode: couponCode || '',
        couponPercentage: couponPercentage || 0,
        couponDiscount: couponDiscount.toFixed(2),
        subtotal: subtotalBeforeDiscounts.toFixed(2),
        vat: vat.toFixed(2),
        total: total.toFixed(2),
        isPartialPaid: isPartialPaid,
        depositAmount: depositAmount.toFixed(2),
        remainingAmount: remainingAmount.toFixed(2),
        paymentMethod: paymentMethod,
      });
      // Send the email with the generated PDF as attachment
      await transporter.sendMail({
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: task.email,
        subject: addStagingToSubject(`Invoice for Order #${task.orderNumber}`),
        html: addStagingBanner(emailContent),
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

  sendRetargetingEmailWithCoupon: async (req, res) => {
    try {
      const { taskId } = req.body;

      if (!taskId) {
        return res.status(400).json({
          message: 'Task ID is required in request body'
        });
      }

      // Find the task with populated items
      const task = await Task.findById(taskId).populate('items.standardItemId');

      if (!task) {
        return res.status(404).json({
          message: 'Task not found'
        });
      }

      // Validate task conditions
      if (task.createdByType !== 'public') {
        return res.status(400).json({
          message: 'This feature is only available for public orders'
        });
      }

      if (task.paymentStatus !== 'Failed') {
        return res.status(400).json({
          message: 'This feature is only available for orders with failed payment status'
        });
      }

      if (!task.email) {
        return res.status(400).json({
          message: 'Customer email is required to send retargeting email'
        });
      }

      // Check if retargeting email was already sent
      if (task.retargetingEmailSent) {
        return res.status(400).json({
          message: 'Retargeting email has already been sent for this order',
          sentAt: task.retargetingEmailSentAt
        });
      }

      // Generate unique 8-character coupon codes
      const generateShortCode = () => Math.random().toString(36).substring(2, 10).toUpperCase();
      const coupon20Code = generateShortCode();
      const coupon10Code = generateShortCode();

      // Calculate expiration dates from current time (when email is sent)
      const emailSentAt = new Date();
      const expiresAt20Percent = new Date(emailSentAt);
      expiresAt20Percent.setHours(expiresAt20Percent.getHours() + 24); // 24 hours from now

      const expiresAt10Percent = new Date(emailSentAt);
      expiresAt10Percent.setHours(expiresAt10Percent.getHours() + 72); // 72 hours from now

      // Create 20% coupon (24 hours, single use)
      const coupon20 = new Coupon({
        code: coupon20Code.toUpperCase(),
        percentage: 20,
        expirationDuration: 24,
        expiresAt: expiresAt20Percent, // Explicitly set expiration date
        description: `Retargeting coupon (20%) for order ${task.orderNumber}`,
        maxUsage: 1, // Single use only
        isActive: true
      });
      await coupon20.save();

      // Create 10% coupon (72 hours, single use)
      const coupon10 = new Coupon({
        code: coupon10Code.toUpperCase(),
        percentage: 10,
        expirationDuration: 72,
        expiresAt: expiresAt10Percent, // Explicitly set expiration date
        description: `Retargeting coupon (10%) for order ${task.orderNumber}`,
        maxUsage: 1, // Single use only
        isActive: true
      });
      await coupon10.save();

      // Calculate discounted totals with minimum fee enforcement
      const originalTotal = task.totalPrice;
      const MINIMUM_TOTAL = 45; // Minimum total after discount

      // Calculate 20% discount
      let discount20Amount = (originalTotal * 20) / 100;
      let discountedTotal20 = originalTotal - discount20Amount;
      let minFeeApplied20 = false;

      // Enforce minimum fee - if discounted total is below £45, set to £45
      if (discountedTotal20 < MINIMUM_TOTAL) {
        discountedTotal20 = MINIMUM_TOTAL;
        discount20Amount = originalTotal - MINIMUM_TOTAL; // Adjust discount amount shown
        minFeeApplied20 = true;
      }

      // Calculate 10% discount
      let discount10Amount = (originalTotal * 10) / 100;
      let discountedTotal10 = originalTotal - discount10Amount;
      let minFeeApplied10 = false;

      // Enforce minimum fee - if discounted total is below £45, set to £45
      if (discountedTotal10 < MINIMUM_TOTAL) {
        discountedTotal10 = MINIMUM_TOTAL;
        discount10Amount = originalTotal - MINIMUM_TOTAL; // Adjust discount amount shown
        minFeeApplied10 = true;
      }

      // Send email
      await sendRetargetingEmail({
        customerEmail: task.email,
        firstName: task.firstName,
        lastName: task.lastName,
        orderNumber: task.orderNumber,
        coupon20Code: coupon20.code,
        coupon10Code: coupon10.code,
        discount20Percentage: 20,
        discount10Percentage: 10,
        items: task.items,
        originalTotal: originalTotal,
        discountedTotal20: discountedTotal20,
        discountedTotal10: discountedTotal10,
        minFeeApplied20: minFeeApplied20,
        minFeeApplied10: minFeeApplied10,
        expirationHours20: 24,
        expirationHours10: 72,
        expiresAt20: expiresAt20Percent,
        expiresAt10: expiresAt10Percent
      });

      // Track that email was sent
      task.retargetingEmailSent = true;
      task.retargetingEmailSentAt = new Date();
      task.retargetingCoupon20Id = coupon20._id;
      task.retargetingCoupon10Id = coupon10._id;
      await task.save();

      // Log the action
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'SEND_RETARGETING_EMAIL',
          entityType: 'TASK',
          entityId: task._id,
          changes: {
            retargetingEmailSent: true,
            coupon20Code: coupon20.code,
            coupon10Code: coupon10.code
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        });
      }

      res.status(200).json({
        message: 'Retargeting email sent successfully',
        coupon20: {
          code: coupon20.code,
          percentage: 20,
          expirationHours: 24
        },
        coupon10: {
          code: coupon10.code,
          percentage: 10,
          expirationHours: 72
        }
      });

    } catch (error) {
      console.error('Error sending retargeting email:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({
        message: 'Failed to send retargeting email',
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  },

  togglePreventReviewEmail: async (req, res) => {
    const { taskId } = req.params;
    const { preventReviewEmail } = req.body;

    try {
      const task = await Task.findById(taskId);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      task.preventReviewEmail = preventReviewEmail !== undefined ? preventReviewEmail : !task.preventReviewEmail;
      await task.save();

      res.status(200).json({
        message: `Review email ${task.preventReviewEmail ? 'prevented' : 'enabled'} for task ${task.orderNumber}`,
        task: {
          _id: task._id,
          orderNumber: task.orderNumber,
          preventReviewEmail: task.preventReviewEmail
        }
      });
    } catch (error) {
      console.error('Error toggling prevent review email:', error);
      res.status(500).json({
        message: 'Failed to update prevent review email setting',
        error: error.message,
      });
    }
  },
  updateMultipleTasksStatus: async (req, res) => {
    const { taskIds, taskStatus, reasonForCancellation } = req.body;

    try {
      // Validate required fields
      if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
        return res.status(400).json({ message: 'taskIds array is required and must not be empty' });
      }

      if (!taskStatus) {
        return res.status(400).json({ message: 'taskStatus is required' });
      }

      // Validate task status
      const validStatuses = ['Not_Completed', 'Completed', 'Cancelled', 'On_Hold', 'Processing', 'New'];
      if (!validStatuses.includes(taskStatus)) {
        return res.status(400).json({ message: 'Invalid task status' });
      }

      // If status is Cancelled, reasonForCancellation is required
      if (taskStatus === 'Cancelled' && !reasonForCancellation) {
        return res.status(400).json({ message: 'reasonForCancellation is required when status is Cancelled' });
      }

      // Validate all task IDs are valid MongoDB ObjectIds
      const invalidIds = taskIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
      if (invalidIds.length > 0) {
        return res.status(400).json({
          message: 'Invalid task IDs provided',
          invalidIds
        });
      }

      // Build update object
      const updateData = { taskStatus };
      if (taskStatus === 'Cancelled' && reasonForCancellation) {
        updateData.reasonForCancellation = reasonForCancellation;
      }

      // Update all tasks in bulk
      const updateResult = await Task.updateMany(
        { _id: { $in: taskIds } },
        { $set: updateData }
      );

      // Check if any tasks were found
      if (updateResult.matchedCount === 0) {
        return res.status(404).json({ message: 'No tasks found with the provided IDs' });
      }

      // Fetch updated tasks
      const updatedTasks = await Task.find({ _id: { $in: taskIds } });

      // Update daily sheets for all affected dates
      try {
        // Extract unique dates from updated tasks
        const uniqueDates = [...new Set(
          updatedTasks
            .filter(task => task.date)
            .map(task => task.date.toISOString().split('T')[0])
        )];

        // Update daily sheets for each unique date
        for (const date of uniqueDates) {
          try {
            console.log('Updating daily sheets after multiple task status update for date:', date);
            const mockReq = {
              body: { date }
            };
            const mockRes = {
              status: () => ({ json: () => { } }),
              json: () => { }
            };

            await dailySheetController.updateExistingDailySheets(mockReq, mockRes);
            console.log('Daily sheets updated for date:', date);
          } catch (dateError) {
            console.error(`Error updating daily sheets for date ${date}:`, dateError);
            // Continue with other dates even if one fails
          }
        }
      } catch (dailySheetError) {
        console.error('Error updating daily sheets after multiple task status update:', dailySheetError);
        // Don't fail the main operation if daily sheet update fails
      }

      res.status(200).json({
        message: `${updateResult.modifiedCount} task(s) updated successfully`,
        updatedCount: updateResult.modifiedCount,
        matchedCount: updateResult.matchedCount,
        tasks: updatedTasks,
      });
    } catch (error) {
      console.error('Error updating tasks:', error);
      res.status(500).json({
        message: 'Failed to update tasks',
        error: error.message,
      });
    }
  },

  takeOverOrder: async (req, res) => {
    const { taskId } = req.params;
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    try {
      // Check if task exists
      const task = await Task.findById(taskId);
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      const lock = await OrderLock.findOne({ taskId });

      if (!lock) {
        // If not locked, just lock it for the current user
        const newLock = await OrderLock.create({
          taskId,
          lockedBy: userId,
          expiresAt: new Date(Date.now() + LOCK_DURATION),
        });

        return res.json({
          message: 'Order locked successfully',
          isLocked: true,
          lockedBy: newLock.lockedBy,
        });
      }

      // Force unlock and lock for current user
      await lock.deleteOne();

      const newLock = await OrderLock.create({
        taskId,
        lockedBy: userId,
        expiresAt: new Date(Date.now() + LOCK_DURATION),
      });

      res.json({
        message: 'Order taken over successfully',
        isLocked: true,
        lockedBy: newLock.lockedBy,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to take over order',
        error: error.message,
      });
    }
  },
};

module.exports = taskCtrl;