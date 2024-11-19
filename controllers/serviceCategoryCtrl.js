const ServiceCategory = require('../models/ServiceCategory');

const serviceCategoryCtrl = {
  createServiceCategory: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Icon image is required' });
      }
      const { name , description } = req.body;
      const icon = req.file.path;
      const newServiceCategory = new ServiceCategory({ name, icon , description});
      await newServiceCategory.save();
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
      const serviceCategories = await ServiceCategory.find().sort('name');
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
    const { name , description } = req.body;
    try {
      const serviceCategory = await ServiceCategory.findById(id);
      if (!serviceCategory) {
        return res.status(404).json({ message: 'Service category not found' });
      }
      const icon = req.file ? req.file.path : serviceCategory.icon;

      const updatedServiceCategory = await ServiceCategory.findByIdAndUpdate(
        id,
        { name, icon , description },
        { new: true },
      );

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
      const serviceCategory = await ServiceCategory.findByIdAndDelete(id);
      if (!serviceCategory) {
        return res.status(404).json({ message: 'Service category not found' });
      }
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
