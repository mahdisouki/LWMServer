const Customer = require('../models/Customer');

const customerCtrl = {
  // Create a new customer
  createCustomer: async (req, res) => {
    try {
      const { email, customNote } = req.body;

      // Check if customer already exists
      const existingCustomer = await Customer.findOne({ email });
      if (existingCustomer) {
        return res.status(400).json({
          message: 'Customer with this email already exists'
        });
      }

      const customer = await Customer.create({
        email,
        customNote
      });

      res.status(201).json({
        message: 'Customer created successfully',
        customer
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to create customer',
        error: error.message
      });
    }
  },

  // Get all customers with pagination
  getAllCustomers: async (req, res) => {
    try {
      const { page = 1, limit = 10, pagination = 'true', keyword } = req.query;

      // Base filter
      let filter = {};

      // Keyword search
      if (keyword) {
        const searchKeyword = keyword.trim();
        filter.$or = [
          { email: { $regex: searchKeyword, $options: 'i' } },
          { customNote: { $regex: searchKeyword, $options: 'i' } }
        ];
      }

      // Count total documents
      const total = await Customer.countDocuments(filter);

      // Build query
      let query = Customer.find(filter).sort('-createdAt');

      // Apply pagination if enabled
      if (pagination === 'true') {
        const currentPage = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (currentPage - 1) * limitNum;
        query = query.skip(skip).limit(limitNum);
      }

      const customers = await query;

      res.status(200).json({
        message: 'Customers retrieved successfully',
        customers,
        meta: {
          currentPage: pagination === 'true' ? parseInt(page, 10) : 1,
          limit: pagination === 'true' ? parseInt(limit, 10) : total,
          total,
          count: customers.length,
          pagination: pagination === 'true'
        }
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve customers',
        error: error.message
      });
    }
  },

  // Get customer by ID
  getCustomerById: async (req, res) => {
    try {
      const customer = await Customer.findById(req.params.id);
      if (!customer) {
        return res.status(404).json({
          message: 'Customer not found'
        });
      }

      res.status(200).json({
        message: 'Customer retrieved successfully',
        customer
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve customer',
        error: error.message
      });
    }
  },

  // Update customer
  updateCustomer: async (req, res) => {
    try {
      const { email, customNote } = req.body;

      const customer = await Customer.findById(req.params.id);
      if (!customer) {
        return res.status(404).json({
          message: 'Customer not found'
        });
      }

      // Check if email is being changed and if it already exists
      if (email && email !== customer.email) {
        const existingCustomer = await Customer.findOne({ email });
        if (existingCustomer) {
          return res.status(400).json({
            message: 'Customer with this email already exists'
          });
        }
      }

      const updatedCustomer = await Customer.findByIdAndUpdate(
        req.params.id,
        {
          email,
          customNote
        },
        { new: true, runValidators: true }
      );

      res.status(200).json({
        message: 'Customer updated successfully',
        customer: updatedCustomer
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update customer',
        error: error.message
      });
    }
  },

  // Delete customer
  deleteCustomer: async (req, res) => {
    try {
      const customer = await Customer.findById(req.params.id);
      if (!customer) {
        return res.status(404).json({
          message: 'Customer not found'
        });
      }

      await Customer.findByIdAndDelete(req.params.id);

      res.status(200).json({
        message: 'Customer deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to delete customer',
        error: error.message
      });
    }
  }
};

module.exports = customerCtrl; 