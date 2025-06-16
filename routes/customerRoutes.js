const express = require('express');
const router = express.Router();
const customerCtrl = require('../controllers/customerCtrl');
const { isAuth } = require('../middlewares/auth');

// Apply auth middleware to all routes

// Customer routes
router.post('/', customerCtrl.createCustomer);
router.get('/', customerCtrl.getAllCustomers);
router.get('/:id', customerCtrl.getCustomerById);
router.put('/:id', customerCtrl.updateCustomer);
router.delete('/:id', customerCtrl.deleteCustomer);

module.exports = router; 