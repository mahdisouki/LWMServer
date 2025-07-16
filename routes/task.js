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

const express = require('express');
const router = express.Router();
const taskCtrl = require('../controllers/taskCtrl'); 
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const multer = require('../middlewares/multer');
const { getPayPalOrderDetails,capturePayPalPayment } = require('../services/paymentService.js');
const Task = require('../models/Task');
router.post('/tasks/lock/:taskId', isAuth, taskCtrl.lockTask);
router.post('/tasks/unlock/:taskId', isAuth, taskCtrl.unlockTask);
router.get('/tasks/lock-status/:taskId', isAuth, taskCtrl.getTaskLockStatus); 
router.post('/create-request', multer.array('clientObjectPhotos'), taskCtrl.createTask);
router.post('/assignTruck/:taskId', isAuth, checkRole('Admin'), taskCtrl.assignTruckToTask);
router.get('/tasks', taskCtrl.getAllTasks);
router.get('/task/:taskId', isAuth, taskCtrl.getTaskById);
router.post('/task/change-job-state/:taskId', isAuth, taskCtrl.updateTaskStatus);
router.put("/tasks/:taskId/traiter", isAuth, checkRole('Admin'), taskCtrl.traiterTask);
router.put('/task/:taskId',multer.array('clientObjectPhotos'),isAuth, taskCtrl.updateTask);
router.put('/tasks/:taskId/moveTruck', isAuth, checkRole('Admin'), taskCtrl.moveTaskToAnotherTruck);
router.put('/tasks/:taskId/deAssignTruck',isAuth, checkRole('Admin'), taskCtrl.deAssignTaskFromTruck);

router.put('/tasks/order' ,isAuth, checkRole('Admin'), taskCtrl.updateTaskOrderInTruck)
router.post('/task/pay/:taskId', taskCtrl.processTaskPayment);
router.post('/task/confirm-stripe-payment', taskCtrl.confirmStripeTaskPayment);

router.post('/task/capture-paypal-payment', taskCtrl.capturePayPalTaskPayment);

router.post('/task/sendPayement/:taskId',taskCtrl.generatePaymentLinks);
// Stripe Webhook
// router.post('/webhooks/stripe',express.raw({ type: 'application/json' }),  taskCtrl.handleStripeWebhook);

// PayPal Webhook
router.post('/webhooks/paypal', express.json(), taskCtrl.handlePayPalWebhook);


// Route pour le succès du paiement
router.get('/webhooks/payment/success', (req, res) => {
    res.send(`
    <html>
      <head>
        <title>Paiement réussi - London Waste Management</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: Arial, sans-serif; background: #f4f8f6; margin: 0; padding: 0; }
          .container { max-width: 500px; margin: 60px auto; background: #fff; border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 40px 30px; text-align: center; }
          .logo { margin-bottom: 20px; }
          .success { color: #4CAF50; font-size: 2.2em; margin-bottom: 10px; }
          .message { font-size: 1.2em; color: #333; margin-bottom: 30px; }
          .cta { display: inline-block; margin-top: 20px; background: #8dc044; color: #fff; padding: 12px 28px; border-radius: 5px; text-decoration: none; font-weight: bold; transition: background 0.2s; }
          .cta:hover { background: #6fa32b; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742959873/slpany1oqx09lxj72nmd.png" width="120"  />
          </div>
          <div class="success">&#10003; Payment Successful!</div>
          <div class="message">Thank you for your payment.<br>Your transaction has been completed successfully.<br>We appreciate your trust in London Waste Management.</div>
          <a class="cta" href="https://londonwastemanagement.com">Return to Home</a>
        </div>
      </body>
    </html>
    `);
});

// Route pour l'annulation du paiement
router.get('/webhooks/payment/cancel', (req, res) => {
    res.send(`
    <html>
      <head>
        <title>Paiement annulé - London Waste Management</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: Arial, sans-serif; background: #f4f8f6; margin: 0; padding: 0; }
          .container { max-width: 500px; margin: 60px auto; background: #fff; border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 40px 30px; text-align: center; }
          .logo { margin-bottom: 20px; }
          .cancel { color: #e53935; font-size: 2.2em; margin-bottom: 10px; }
          .message { font-size: 1.2em; color: #333; margin-bottom: 30px; }
          .cta { display: inline-block; margin-top: 20px; background: #8dc044; color: #fff; padding: 12px 28px; border-radius: 5px; text-decoration: none; font-weight: bold; transition: background 0.2s; }
          .cta:hover { background: #6fa32b; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742959873/slpany1oqx09lxj72nmd.png" width="120" alt="London Waste Management" />
          </div>
          <div class="cancel">&#10007; Payment Cancelled</div>
          <div class="message">Your payment was cancelled.<br>If you wish, you can try again or contact our support team for assistance.</div>
          <a class="cta" href="https://londonwastemanagement.com">Return to Home</a>
        </div>
      </body>
    </html>
    `);
});

router.post('/task/:taskId/send-booking-confirmation', taskCtrl.sendBookingConfirmation);
router.post('/task/:taskId/send-invoice', taskCtrl.sendInvoice);
router.post('/task/:taskId/send-waste-transfer-note', taskCtrl.sendWasteTransferNote);
module.exports = router;
