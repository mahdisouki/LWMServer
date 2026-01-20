const Coupon = require('../models/Coupon');
const loggingService = require('../services/loggingService');

const couponCtrl = {
  // Create a new coupon
  createCoupon: async (req, res) => {
    try {
      const {
        type = 'random', // Default to 'random' for backward compatibility
        code,
        percentage,
        expirationDuration,
        description,
        maxUsage,
        // Custom coupon fields
        startDate,
        endDate,
        discountType,
        discountValue,
        minimumOrderAmount = 0,
        maxUsagePerCustomer
      } = req.body;

      // Validate type
      if (type !== 'random' && type !== 'custom') {
        return res.status(400).json({
          message: 'Type must be either "random" or "custom"'
        });
      }

      // Validate based on type
      if (type === 'random') {
        // Random coupon validation
        if (!code || !percentage || !expirationDuration) {
          return res.status(400).json({
            message: 'Code, percentage, and expiration duration are required for random coupons'
          });
        }

        if (percentage < 0 || percentage > 100) {
          return res.status(400).json({
            message: 'Percentage must be between 0 and 100'
          });
        }

        if (expirationDuration <= 0) {
          return res.status(400).json({
            message: 'Expiration duration must be greater than 0'
          });
        }
      } else {
        // Custom coupon validation
        if (!code || !startDate || !endDate || !discountType || discountValue === undefined) {
          return res.status(400).json({
            message: 'Code, startDate, endDate, discountType, and discountValue are required for custom coupons'
          });
        }

        if (discountType !== 'percentage' && discountType !== 'amount') {
          return res.status(400).json({
            message: 'Discount type must be either "percentage" or "amount"'
          });
        }

        if (discountType === 'percentage' && (discountValue < 0 || discountValue > 100)) {
          return res.status(400).json({
            message: 'Percentage discount value must be between 0 and 100'
          });
        }

        if (discountType === 'amount' && discountValue < 0) {
          return res.status(400).json({
            message: 'Amount discount value must be greater than or equal to 0'
          });
        }

        if (new Date(startDate) >= new Date(endDate)) {
          return res.status(400).json({
            message: 'End date must be after start date'
          });
        }

        if (minimumOrderAmount < 0) {
          return res.status(400).json({
            message: 'Minimum order amount must be greater than or equal to 0'
          });
        }

        if (maxUsagePerCustomer !== undefined && maxUsagePerCustomer !== null && maxUsagePerCustomer < 1) {
          return res.status(400).json({
            message: 'Max usage per customer must be greater than 0'
          });
        }
      }

      // Check if coupon code already exists
      const existingCoupon = await Coupon.findOne({ code: code.toUpperCase().trim() });
      if (existingCoupon) {
        return res.status(400).json({
          message: 'Coupon code already exists'
        });
      }

      // Create coupon based on type
      const couponData = {
        type,
        code: code.toUpperCase().trim(),
        description: description || '',
        maxUsage: maxUsage || null,
        isActive: req.body.isActive !== undefined ? req.body.isActive : true
      };

      if (type === 'random') {
        couponData.percentage = percentage;
        couponData.expirationDuration = expirationDuration;
        couponData.expiresAt = new Date(Date.now() + (expirationDuration * 60 * 60 * 1000));
      } else {
        couponData.startDate = new Date(startDate);
        couponData.endDate = new Date(endDate);
        couponData.expiresAt = new Date(endDate);
        couponData.discountType = discountType;
        couponData.discountValue = discountValue;
        couponData.minimumOrderAmount = minimumOrderAmount || 0;
        couponData.maxUsagePerCustomer = maxUsagePerCustomer || null;
      }

      const coupon = new Coupon(couponData);
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
          valid: false,
          message: 'Coupon not found'
        });
      }

      // Build response based on coupon type (without validation)
      let discountType, discountValue;

      if (coupon.type === 'random') {
        discountType = 'percentage';
        discountValue = coupon.percentage;
      } else {
        discountType = coupon.discountType;
        discountValue = coupon.discountValue;
      }

      // Build response based on coupon type
      const response = {
        valid: true,
        message: 'Coupon is valid',
        discountType: discountType,
        discountValue: discountValue,
        coupon: coupon.toObject()
      };

      // For backward compatibility, include percentage if it's a percentage discount
      if (discountType === 'percentage') {
        response.percentage = discountValue;
      } else {
        response.percentage = null;
      }

      res.status(200).json(response);
    } catch (error) {
      console.error('Error fetching coupon:', error);
      res.status(500).json({
        message: 'Failed to fetch coupon',
        error: error.message
      });
    }
  },

  // Validate coupon code (basic validation - only checks code)
  // Full validation with customerEmail and cartTotal happens in createTask/updateTask
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

      // Basic validation only (without customerEmail and cartTotal)
      // Full validation with email and cart total happens in createTask/updateTask
      const validation = coupon.validateCoupon(null, null);

      if (!validation.valid) {
        return res.status(200).json({
          valid: false,
          message: validation.message
        });
      }

      // Build response based on coupon type
      const response = {
        valid: true,
        message: 'Coupon is valid',
        discountType: validation.discountType,
        discountValue: validation.discountValue,
        coupon: {
          id: coupon._id,
          code: coupon.code,
          type: coupon.type,
          expiresAt: coupon.expiresAt
        }
      };

      // For backward compatibility, include percentage if it's a percentage discount
      if (validation.discountType === 'percentage') {
        response.percentage = validation.discountValue;
        response.coupon.percentage = validation.discountValue;
      } else {
        response.percentage = null;
      }

      res.status(200).json(response);
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
      const {
        code,
        percentage,
        isExpired,
        isActive,
        description,
        maxUsage,
        // Custom coupon fields
        startDate,
        endDate,
        discountType,
        discountValue,
        minimumOrderAmount,
        maxUsagePerCustomer
      } = req.body;

      const coupon = await Coupon.findById(id);

      if (!coupon) {
        return res.status(404).json({
          message: 'Coupon not found'
        });
      }

      // Store old values for logging
      const oldCoupon = coupon.toObject();

      // Update common fields
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

      // Update fields based on coupon type
      if (coupon.type === 'random') {
        // Random coupon fields
        if (percentage !== undefined) {
          if (percentage < 0 || percentage > 100) {
            return res.status(400).json({
              message: 'Percentage must be between 0 and 100'
            });
          }
          coupon.percentage = percentage;
        }
      } else {
        // Custom coupon fields
        if (startDate !== undefined) {
          coupon.startDate = new Date(startDate);
        }
        if (endDate !== undefined) {
          coupon.endDate = new Date(endDate);
          coupon.expiresAt = new Date(endDate); // Sync expiresAt with endDate
        }
        if (discountType !== undefined) {
          if (discountType !== 'percentage' && discountType !== 'amount') {
            return res.status(400).json({
              message: 'Discount type must be either "percentage" or "amount"'
            });
          }
          coupon.discountType = discountType;
        }
        if (discountValue !== undefined) {
          if (coupon.discountType === 'percentage' && (discountValue < 0 || discountValue > 100)) {
            return res.status(400).json({
              message: 'Percentage discount value must be between 0 and 100'
            });
          }
          if (coupon.discountType === 'amount' && discountValue < 0) {
            return res.status(400).json({
              message: 'Amount discount value must be greater than or equal to 0'
            });
          }
          coupon.discountValue = discountValue;
        }
        if (minimumOrderAmount !== undefined) {
          if (minimumOrderAmount < 0) {
            return res.status(400).json({
              message: 'Minimum order amount must be greater than or equal to 0'
            });
          }
          coupon.minimumOrderAmount = minimumOrderAmount;
        }
        if (maxUsagePerCustomer !== undefined) {
          if (maxUsagePerCustomer !== null && maxUsagePerCustomer < 1) {
            return res.status(400).json({
              message: 'Max usage per customer must be greater than 0 or null'
            });
          }
          coupon.maxUsagePerCustomer = maxUsagePerCustomer;
        }

        // Validate date range if both dates are present
        if (coupon.startDate && coupon.endDate && coupon.startDate >= coupon.endDate) {
          return res.status(400).json({
            message: 'End date must be after start date'
          });
        }
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
