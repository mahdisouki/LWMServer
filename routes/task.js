const express = require('express');
const router = express.Router();
const taskCtrl = require('../controllers/taskCtrl'); 
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');
const multer = require('../middlewares/multer');


router.post('/create-request', isAuth, checkRole('Admin'), multer.array('clientObjectPhotos'), taskCtrl.createTask);
router.post('/assignTruck/:taskId', isAuth, checkRole('Admin'), taskCtrl.assignTruckToTask);
router.get('/tasks', isAuth, checkRole('Admin'), taskCtrl.getAllTasks);
router.get('/task/:taskId', isAuth, taskCtrl.getTaskById);
router.post('/task/change-job-state/:taskId', isAuth, taskCtrl.updateTaskStatus);
router.put("/tasks/:taskId/traiter", isAuth, checkRole('Admin'), taskCtrl.traiterTask);
router.put('/task/:taskId', isAuth, checkRole('Admin'),multer.array('clientObjectPhotos'), taskCtrl.updateTask);
router.put('/tasks/:taskId/moveTruck', isAuth, checkRole('Admin'), taskCtrl.moveTaskToAnotherTruck);
router.put('/tasks/:taskId/deAssignTruck',isAuth, checkRole('Admin'), taskCtrl.deAssignTaskFromTruck);
router.post('/task/pay/:taskId', taskCtrl.processTaskPayment);

router.post('/task/confirm-stripe-payment', taskCtrl.confirmStripeTaskPayment);

router.post('/task/capture-paypal-payment', taskCtrl.capturePayPalTaskPayment);

module.exports = router;
