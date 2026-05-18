/**
 * @swagger
 * /api/task/pay/{taskId}:
 *   post:
 *     summary: Initiate payment for a task
 *     tags: [Task Payments]
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the task to pay for
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               paymentType:
 *                 type: string
 *                 description: The type of payment (e.g., 'stripe' or 'paypal')
 *                 example: "stripe"
 *     responses:
 *       200:
 *         description: Payment initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 clientSecret:
 *                   type: string
 *                 paymentIntentId:
 *                   type: string
 *                 amount:
 *                   type: integer
 *                 paymentType:
 *                   type: string
 *                 options:
 *                   type: object
 *       404:
 *         description: Task not found
 *       500:
 *         description: Failed to initiate payment
 */

/**
 * @swagger
 * /api/task/confirm-stripe-payment:
 *   post:
 *     summary: Confirm a Stripe payment for a task
 *     tags: [Task Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               paymentIntentId:
 *                 type: string
 *                 description: The Stripe Payment Intent ID
 *                 example: "pi_1JyZj0K9jLsYZuk8rj2ZTxWF"
 *               paymentMethodId:
 *                 type: string
 *                 description: The Stripe Payment Method ID
 *                 example: "pm_1JyZj0K9jLsYZuk8rj2ZTxWF"
 *               taskId:
 *                 type: string
 *                 description: The ID of the task
 *                 example: "605c5fc2f7a84e3e9c43c6b2"
 *     responses:
 *       200:
 *         description: Payment confirmed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 task:
 *                   $ref: '#/components/schemas/Task'
 *                 paymentIntent:
 *                   type: object
 *       400:
 *         description: Payment confirmation failed
 *       404:
 *         description: Task not found
 *       500:
 *         description: Error confirming payment
 */

/**
 * @swagger
 * /api/task/capture-paypal-payment:
 *   post:
 *     summary: Capture a PayPal payment for a task
 *     tags: [Task Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               orderID:
 *                 type: string
 *                 description: The PayPal order ID
 *                 example: "2RV02359N7899878F"
 *               taskId:
 *                 type: string
 *                 description: The ID of the task
 *                 example: "605c5fc2f7a84e3e9c43c6b2"
 *     responses:
 *       200:
 *         description: PayPal payment captured successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 captureDetails:
 *                   type: object
 *                 task:
 *                   $ref: '#/components/schemas/Task'
 *       400:
 *         description: Failed to capture payment
 *       404:
 *         description: Task not found
 *       500:
 *         description: Error capturing PayPal payment
 */

/**
 * @swagger
 * /api/task/tasks/update-status:
 *   put:
 *     summary: Update status of multiple tasks
 *     tags: [Tasks]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - taskIds
 *               - taskStatus
 *             properties:
 *               taskIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of task IDs to update
 *                 example: ["605c5fc2f7a84e3e9c43c6b2", "605c5fc2f7a84e3e9c43c6b3"]
 *               taskStatus:
 *                 type: string
 *                 enum: [Not_Completed, Completed, Cancelled, On_Hold, Processing, New]
 *                 description: The new status for the tasks
 *                 example: "Cancelled"
 *               reasonForCancellation:
 *                 type: string
 *                 description: Required when taskStatus is Cancelled
 *                 example: "Customer requested cancellation"
 *     responses:
 *       200:
 *         description: Tasks updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 updatedCount:
 *                   type: number
 *                 matchedCount:
 *                   type: number
 *                 tasks:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Task'
 *       400:
 *         description: Bad request - invalid input
 *       404:
 *         description: No tasks found with provided IDs
 *       500:
 *         description: Failed to update tasks
 */

/**
 * @swagger
 * /api/task/{taskId}/mark-on-hold:
 *   post:
 *     summary: Driver puts a task on hold
 *     description: Allows the driver assigned to the task's truck (main or extra) to change the task status to "On_Hold". Admins are notified.
 *     tags: [Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the task to put on hold
 *     responses:
 *       200:
 *         description: Task marked as On_Hold successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 task:
 *                   $ref: '#/components/schemas/Task'
 *       400:
 *         description: Task cannot be put on hold from its current status
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Driver is not assigned to this task
 *       404:
 *         description: Task not found
 *       500:
 *         description: Failed to put task on hold
 */

const express = require('express');
const router = express.Router();
const taskCtrl = require('../controllers/taskCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const multer = require('../middlewares/multer');
// Payment link rate limiters disabled — re-enable middleware on GET /payment-link/:token/:provider if needed.
// const {
//   paymentLinkIpLimiter,
//   paymentLinkTokenLimiter,
// } = require('../middlewares/rateLimiter');
const { getPayPalOrderDetails, capturePayPalPayment } = require('../services/paymentService.js');
const Task = require('../models/Task');
router.post('/tasks/lock/:taskId', isAuth, taskCtrl.lockTask);
router.post('/tasks/unlock/:taskId', isAuth, taskCtrl.unlockTask);
router.get('/tasks/lock-status/:taskId', isAuth, taskCtrl.getTaskLockStatus);
router.post('/tasks/take-over/:taskId', isAuth, checkRole('Admin'), taskCtrl.takeOverOrder);
router.post('/create-request', multer.array('clientObjectPhotos'), taskCtrl.createTask);
router.post('/assignTruck/:taskId', isAuth, checkRole('Admin'), taskCtrl.assignTruckToTask);
router.get('/tasks', taskCtrl.getAllTasks);
router.get('/tasks/export/completed-paid', taskCtrl.exportCompletedPaidCsv);
router.get('/tasks/by-date', taskCtrl.getTasksByDateLite);
router.get('/tasks/stats/top-items', taskCtrl.getTop10ItemsOrdered);
router.get('/tasks/stats/top-postcodes', taskCtrl.getTop10PostcodesInOrders);
router.get('/task/:taskId', taskCtrl.getTaskById);
router.get('/task/order-number/:orderNumber', taskCtrl.getTaskByOrderNumber);
router.post('/task/change-job-state/:taskId', isAuth, taskCtrl.updateTaskStatus);
router.post('/task/:taskId/mark-on-hold', isAuth, taskCtrl.markTaskOnHold);
router.put("/tasks/:taskId/traiter", isAuth, checkRole('Admin'), taskCtrl.traiterTask);
router.put('/task/:taskId', multer.array('clientObjectPhotos'), isAuth, taskCtrl.updateTask);
router.put('/tasks/:taskId/moveTruck', isAuth, checkRole('Admin'), taskCtrl.moveTaskToAnotherTruck);
router.put('/tasks/:taskId/deAssignTruck', isAuth, checkRole('Admin'), taskCtrl.deAssignTaskFromTruck);

router.put('/tasks/order', isAuth, checkRole('Admin'), taskCtrl.updateTaskOrderInTruck)
router.post('/task/pay/:taskId', taskCtrl.processTaskPayment);
router.post('/task/confirm-stripe-payment', taskCtrl.confirmStripeTaskPayment);

router.post('/task/capture-paypal-payment', taskCtrl.capturePayPalTaskPayment);
router.post('/task/sendPayement/:taskId', taskCtrl.generatePaymentLinks);
router.get('/payment-link/:token/:provider', taskCtrl.resolvePaymentLink);
// Stripe Webhook
// router.post('/webhooks/stripe',express.raw({ type: 'application/json' }),  taskCtrl.handleStripeWebhook);

// PayPal Webhook
router.post('/webhooks/paypal', express.json(), taskCtrl.handlePayPalWebhook);

router.post('/task/:taskId/send-booking-confirmation', taskCtrl.sendBookingConfirmation);
router.post('/task/:taskId/send-invoice', taskCtrl.sendInvoice);
router.get('/task/:taskId/download-invoice', taskCtrl.downloadInvoice);
router.post('/task/:taskId/send-waste-transfer-note', taskCtrl.sendWasteTransferNote);
router.post('/task/send-retargeting-email', isAuth, checkRole('Admin'), taskCtrl.sendRetargetingEmailWithCoupon);
router.put('/task/:taskId/prevent-review-email', isAuth, taskCtrl.togglePreventReviewEmail);
router.put('/tasks/update-status', isAuth, checkRole('Admin'), taskCtrl.updateMultipleTasksStatus);
router.post('/task/:taskId/additional-items/direct-create', isAuth, checkRole('Admin'), taskCtrl.createDirectAdditionalLinkedTask);
router.get('/additional-items/requests', isAuth, checkRole('Admin'), taskCtrl.getAdditionalItemRequestsForAdmin);
router.put('/task/:taskId/additional-items/requests/:requestId/quote', isAuth, checkRole('Admin'), taskCtrl.quoteAdditionalItemRequest);
router.put('/task/:taskId/additional-items/requests/:requestId/respond', isAuth, taskCtrl.respondToAdditionalItemRequest);
module.exports = router;
