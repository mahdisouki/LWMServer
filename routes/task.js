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
router.put("/tasks/:taskId/traiter", isAuth, checkRole('Admin'), taskCtrl.traiterTask);
router.put('/task/:taskId', isAuth, checkRole('Admin'),multer.array('clientObjectPhotos'), taskCtrl.updateTask);



module.exports = router;
