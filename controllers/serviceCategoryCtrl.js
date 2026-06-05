const ServiceCategory = require('../models/ServiceCategory');
const loggingService = require('../services/loggingService');

const serviceCategoryCtrl = {
  createServiceCategory: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Icon image is required' });
      }
      const { name, topDescription, bottomDescription } = req.body;
      const icon = req.file.path;
      const newServiceCategory = new ServiceCategory({ name, icon, topDescription, bottomDescription });
      await newServiceCategory.save();

      // Create a log of the service category creation
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'CREATE',
          entityType: 'SERVICE_CATEGORY',
          entityId: newServiceCategory._id,
          changes: {
            created: newServiceCategory.toObject(),
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      res.status(201).json({
        message: 'Service category created successfully',
        serviceCategory: newServiceCategory,
      });
    } catch (error) {
      console.log(error)
      res.status(500).json({
        message: 'Failed to create service category',
        error: error.message,
      });
    }
  },

  getAllServiceCategories: async (req, res) => {
    try {
      const serviceCategories = await ServiceCategory.find().sort({ name: 1 }).lean();

      res.status(200).json({
        message: 'All service categories fetched successfully',
        serviceCategories,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to fetch service categories',
        error: error.message,
      });
    }
  },

  getServiceCategoryById: async (req, res) => {
    const { id } = req.params;
    try {
      const serviceCategory = await ServiceCategory.findById(id);
      if (!serviceCategory) {
        return res.status(404).json({ message: 'Service category not found' });
      }
      res.status(200).json({
        message: 'Service category fetched successfully',
        serviceCategory,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to fetch service category',
        error: error.message,
      });
    }
  },

  updateServiceCategory: async (req, res) => {
    const { id } = req.params;
    const { name, topDescription, bottomDescription } = req.body;
    try {
      const oldServiceCategory = await ServiceCategory.findById(id);
      if (!oldServiceCategory) {
        return res.status(404).json({ message: 'Service category not found' });
      }
      const icon = req.file ? req.file.path : oldServiceCategory.icon;

      const updatedServiceCategory = await ServiceCategory.findByIdAndUpdate(
        id,
        { name, icon, topDescription, bottomDescription },
        { new: true },
      );

      // Create a log of the changes
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'UPDATE',
          entityType: 'SERVICE_CATEGORY',
          entityId: id,
          changes: {
            before: oldServiceCategory.toObject(),
            after: updatedServiceCategory.toObject(),
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      res.status(200).json({
        message: 'Service category updated successfully',
        serviceCategory: updatedServiceCategory,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update service category',
        error: error.message,
      });
    }
  },

  deleteServiceCategory: async (req, res) => {
    const { id } = req.params;
    try {
      const serviceCategory = await ServiceCategory.findById(id);
      if (!serviceCategory) {
        return res.status(404).json({ message: 'Service category not found' });
      }

      // Create a log of the deletion before actually deleting
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'DELETE',
          entityType: 'SERVICE_CATEGORY',
          entityId: id,
          changes: {
            deleted: serviceCategory.toObject(),
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      await ServiceCategory.findByIdAndDelete(id);
      res.status(200).json({
        message: 'Service category deleted successfully',
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to delete service category',
        error: error.message,
      });
    }
  },
};

module.exports = serviceCategoryCtrl;
