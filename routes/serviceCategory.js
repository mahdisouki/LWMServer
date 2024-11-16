const express = require('express');
const multer = require('../middlewares/multer');
const serviceCategoryCtrl = require('../controllers/serviceCategoryCtrl');
const router = express.Router();

router.post('/service-categories' ,multer.single('icon'), serviceCategoryCtrl.createServiceCategory);
router.get('/service-categories', serviceCategoryCtrl.getAllServiceCategories);
router.get('/service-categories/:id', serviceCategoryCtrl.getServiceCategoryById);
router.put('/service-categories/:id' ,multer.single('icon'), serviceCategoryCtrl.updateServiceCategory);
router.delete('/service-categories/:id', serviceCategoryCtrl.deleteServiceCategory);

module.exports = router;
