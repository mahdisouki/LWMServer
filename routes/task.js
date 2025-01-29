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

router.post('/create-request', multer.array('clientObjectPhotos'), taskCtrl.createTask);
router.post('/assignTruck/:taskId', isAuth, checkRole('Admin'), taskCtrl.assignTruckToTask);
router.get('/tasks', isAuth, checkRole('Admin'), taskCtrl.getAllTasks);
router.get('/task/:taskId', isAuth, taskCtrl.getTaskById);
router.post('/task/change-job-state/:taskId', isAuth, taskCtrl.updateTaskStatus);
router.put("/tasks/:taskId/traiter", isAuth, checkRole('Admin'), taskCtrl.traiterTask);
router.put('/task/:taskId', isAuth, checkRole('Admin'),multer.array('clientObjectPhotos'), taskCtrl.updateTask);
router.put('/tasks/:taskId/moveTruck', isAuth, checkRole('Admin'), taskCtrl.moveTaskToAnotherTruck);
router.put('/tasks/:taskId/deAssignTruck',isAuth, checkRole('Admin'), taskCtrl.deAssignTaskFromTruck);

router.put('/tasks/order' ,isAuth, checkRole('Admin'), taskCtrl.updateTaskOrderInTruck)
router.post('/task/pay/:taskId', taskCtrl.processTaskPayment);
router.post('/task/confirm-stripe-payment', taskCtrl.confirmStripeTaskPayment);

router.post('/task/capture-paypal-payment', taskCtrl.capturePayPalTaskPayment);

router.post('/task/sendPayement/:taskId',taskCtrl.generatePaymentLinks);
// Stripe Webhook
router.post('/webhooks/stripe',express.raw({ type: 'application/json' }),  taskCtrl.handleStripeWebhook);

// PayPal Webhook
router.post('/webhooks/paypal', express.json(), taskCtrl.handlePayPalWebhook);


// Route pour le succès du paiement
router.get('/webhooks/payment/success', (req, res) => {
    res.send('<h1>Merci ! Votre paiement a été effectué avec succès !</h1>');
});

// Route pour l'annulation du paiement
router.get('/webhooks/payment/cancel', (req, res) => {
    res.send('<h1>Paiement annulé. Vous pouvez réessayer si vous le souhaitez.</h1>');
});


module.exports = router;
