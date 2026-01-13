const Coupon = require('../models/Coupon');
const loggingService = require('../services/loggingService');

const couponCtrl = {
  // Create a new coupon
  createCoupon: async (req, res) => {
    try {
      const { code, percentage, expirationDuration, description, maxUsage } = req.body;

      // Validate required fields
      if (!code || !percentage || !expirationDuration) {
        return res.status(400).json({
          message: 'Code, percentage, and expiration duration are required'
        });
      }

      // Validate percentage range
      if (percentage < 0 || percentage > 100) {
        return res.status(400).json({
          message: 'Percentage must be between 0 and 100'
        });
      }

      // Validate expiration duration
      if (expirationDuration <= 0) {
        return res.status(400).json({
          message: 'Expiration duration must be greater than 0'
        });
      }

      // Check if coupon code already exists
      const existingCoupon = await Coupon.findOne({ code: code.toUpperCase().trim() });
      if (existingCoupon) {
        return res.status(400).json({
          message: 'Coupon code already exists'
        });
      }

      // Create coupon
      const coupon = new Coupon({
        code: code.toUpperCase().trim(),
        percentage,
        expirationDuration,
        description: description || '',
        maxUsage: maxUsage || null,
        expiresAt: new Date(Date.now() + (expirationDuration * 60 * 60 * 1000))
      });

      await coupon.save();

      // Log the creation
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'CREATE',
          entityType: 'COUPON',
          entityId: coupon._id,
          changes: {
            created: coupon.toObject()
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        });
      }

      res.status(201).json({
        message: 'Coupon created successfully',
        coupon
      });
    } catch (error) {
      console.error('Error creating coupon:', error);
      res.status(500).json({
        message: 'Failed to create coupon',
        error: error.message
      });
    }
  },

  // Get all coupons
  getAllCoupons: async (req, res) => {
    try {
      const { page = '1', limit = '10', isExpired, isActive } = req.query;
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
      const skip = (pageNum - 1) * limitNum;

      // Build filter
      const filter = {};
      if (isExpired !== undefined) {
        filter.isExpired = isExpired === 'true';
      }
      if (isActive !== undefined) {
        filter.isActive = isActive === 'true';
      }

      // Get total count
      const total = await Coupon.countDocuments(filter);

      // Get coupons
      const coupons = await Coupon.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum);

      res.status(200).json({
        message: 'Coupons retrieved successfully',
        coupons,
        meta: {
          currentPage: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum)
        }
      });
    } catch (error) {
      console.error('Error fetching coupons:', error);
      res.status(500).json({
        message: 'Failed to fetch coupons',
        error: error.message
      });
    }
  },

  // Get coupon by ID
  getCouponById: async (req, res) => {
    try {
      const { id } = req.params;
      const coupon = await Coupon.findById(id);

      if (!coupon) {
        return res.status(404).json({
          message: 'Coupon not found'
        });
      }

      res.status(200).json({
        message: 'Coupon retrieved successfully',
        coupon
      });
    } catch (error) {
      console.error('Error fetching coupon:', error);
      res.status(500).json({
        message: 'Failed to fetch coupon',
        error: error.message
      });
    }
  },

  // Validate coupon code
  validateCoupon: async (req, res) => {
    try {
      const { code } = req.body;

      if (!code) {
        return res.status(400).json({
          message: 'Coupon code is required'
        });
      }

      const coupon = await Coupon.findOne({ code: code.toUpperCase().trim() });

      if (!coupon) {
        return res.status(404).json({
          valid: false,
          message: 'Coupon code not found'
        });
      }

      const validation = coupon.validateCoupon();

      if (!validation.valid) {
        return res.status(200).json({
          valid: false,
          message: validation.message
        });
      }

      res.status(200).json({
        valid: true,
        message: 'Coupon is valid',
        percentage: validation.percentage,
        coupon: {
          id: coupon._id,
          code: coupon.code,
          percentage: coupon.percentage,
          expiresAt: coupon.expiresAt
        }
      });
    } catch (error) {
      console.error('Error validating coupon:', error);
      res.status(500).json({
        message: 'Failed to validate coupon',
        error: error.message
      });
    }
  },

  // Update coupon
  updateCoupon: async (req, res) => {
    try {
      const { id } = req.params;
      const { code, percentage, isExpired, isActive, description, maxUsage } = req.body;

      const coupon = await Coupon.findById(id);

      if (!coupon) {
        return res.status(404).json({
          message: 'Coupon not found'
        });
      }

      // Store old values for logging
      const oldCoupon = coupon.toObject();

      // Update fields
      if (code !== undefined) {
        const existingCoupon = await Coupon.findOne({ 
          code: code.toUpperCase().trim(),
          _id: { $ne: id }
        });
        if (existingCoupon) {
          return res.status(400).json({
            message: 'Coupon code already exists'
          });
        }
        coupon.code = code.toUpperCase().trim();
      }
      if (percentage !== undefined) {
        if (percentage < 0 || percentage > 100) {
          return res.status(400).json({
            message: 'Percentage must be between 0 and 100'
          });
        }
        coupon.percentage = percentage;
      }
      if (isExpired !== undefined) {
        coupon.isExpired = isExpired;
      }
      if (isActive !== undefined) {
        coupon.isActive = isActive;
      }
      if (description !== undefined) {
        coupon.description = description;
      }
      if (maxUsage !== undefined) {
        coupon.maxUsage = maxUsage;
      }

      await coupon.save();

      // Log the update
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'UPDATE',
          entityType: 'COUPON',
          entityId: coupon._id,
          changes: {
            old: oldCoupon,
            new: coupon.toObject()
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        });
      }

      res.status(200).json({
        message: 'Coupon updated successfully',
        coupon
      });
    } catch (error) {
      console.error('Error updating coupon:', error);
      res.status(500).json({
        message: 'Failed to update coupon',
        error: error.message
      });
    }
  },

  // Delete coupon
  deleteCoupon: async (req, res) => {
    try {
      const { id } = req.params;
      const coupon = await Coupon.findById(id);

      if (!coupon) {
        return res.status(404).json({
          message: 'Coupon not found'
        });
      }

      // Store for logging
      const oldCoupon = coupon.toObject();

      await Coupon.findByIdAndDelete(id);

      // Log the deletion
      if (req.user) {
        await loggingService.createLog({
          userId: req.user._id,
          username: req.user.username,
          action: 'DELETE',
          entityType: 'COUPON',
          entityId: id,
          changes: {
            deleted: oldCoupon
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        });
      }

      res.status(200).json({
        message: 'Coupon deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting coupon:', error);
      res.status(500).json({
        message: 'Failed to delete coupon',
        error: error.message
      });
    }
  }
};

module.exports = couponCtrl;
