const ServiceCategory = require('../models/ServiceCategory');
const Task = require('../models/Task');
const StandardItem = require('../models/StandardItem');
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
      const categoryPopularity = await Task.aggregate([
        {
          $match: {
            paymentStatus: { $in: ['Paid', 'partial_Paid'] },
            taskStatus: { $ne: 'Cancelled' },
            'items.standardItemId': { $ne: null }
          }
        },
        { $unwind: '$items' },
        {
          $match: {
            'items.standardItemId': { $ne: null }
          }
        },
        {
          $lookup: {
            from: StandardItem.collection.name,
            localField: 'items.standardItemId',
            foreignField: '_id',
            as: 'itemDoc'
          }
        },
        { $unwind: '$itemDoc' },
        { $unwind: '$itemDoc.category' },
        {
          $group: {
            _id: '$itemDoc.category',
            purchasedCount: {
              $sum: {
                $cond: [
                  { $gt: ['$items.quantity', 0] },
                  '$items.quantity',
                  1
                ]
              }
            },
            timesPurchased: { $sum: 1 }
          }
        }
      ]);

      const popularityMap = new Map(
        categoryPopularity.map((entry) => [String(entry._id), entry])
      );

      const serviceCategories = await ServiceCategory.find();

      const sortedCategories = serviceCategories
        .map((category) => {
          const popularity = popularityMap.get(String(category._id));
          return {
            ...category.toObject(),
            purchasedCount: popularity?.purchasedCount || 0,
            timesPurchased: popularity?.timesPurchased || 0
          };
        })
        .sort((a, b) => {
          if (b.purchasedCount !== a.purchasedCount) {
            return b.purchasedCount - a.purchasedCount;
          }
          if (b.timesPurchased !== a.timesPurchased) {
            return b.timesPurchased - a.timesPurchased;
          }
          return a.name.localeCompare(b.name);
        });

      res.status(200).json({
        message: 'All service categories fetched successfully',
        serviceCategories: sortedCategories,
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
