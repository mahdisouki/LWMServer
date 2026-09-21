const Coupon = require('../models/Coupon');
const loggingService = require('../services/loggingService');
const { getRealIP } = require('../middlewares/rateLimiter');

const EXIT_INTENT_DESCRIPTION = 'Exit-intent popup coupon';
const EXIT_INTENT_PERCENTAGE = 20;
const EXIT_INTENT_TTL_MS = 5 * 60 * 1000; // 5 minutes after reveal
const EXIT_INTENT_CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;
const EXIT_INTENT_ALREADY_CLAIMED_MESSAGE =
  "You've already claimed this exclusive 20% offer. Please try again later.";

function serializeExitIntentCoupon(coupon) {
  return {
    id: coupon._id,
    code: coupon.code,
    type: coupon.type,
    percentage: coupon.percentage ?? EXIT_INTENT_PERCENTAGE,
    expiresAt: coupon.expiresAt,
    revealedAt: coupon.revealedAt || null,
    maxUsage: 1,
  };
}

function isUnusedExitIntentReusable(coupon) {
  const unused = (coupon.usageCount || 0) < 1;
  if (!unused || coupon.isExpired || coupon.isActive === false) return false;
  if (!coupon.revealedAt) return true;
  return coupon.validateCoupon(null, null).valid;
}

async function startExitIntentClock(coupon) {
  if (coupon.revealedAt) return coupon;
  coupon.revealedAt = new Date();
  coupon.expiresAt = new Date(Date.now() + EXIT_INTENT_TTL_MS);
  coupon.expirationDuration = EXIT_INTENT_TTL_MS / (60 * 60 * 1000);
  await coupon.save();
  return coupon;
}

function exitIntentSuccessBody(coupon, { reused, message }) {
  return {
    valid: true,
    message,
    reused,
    discountType: 'percentage',
    discountValue: EXIT_INTENT_PERCENTAGE,
    percentage: EXIT_INTENT_PERCENTAGE,
    coupon: serializeExitIntentCoupon(coupon),
  };
}

const parseBooleanQuery = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;

  return undefined;
};

const buildCouponFilter = (query = {}) => {
  const {
    isExpired,
    isActive,
    type,
    code,
    createdFrom,
    createdTo,
    validFrom,
    validTo,
    minUsage,
    maxUsage
  } = query;

  const filter = {};

  const parsedIsExpired = parseBooleanQuery(isExpired);
  const parsedIsActive = parseBooleanQuery(isActive);

  if (parsedIsExpired !== undefined) {
    const now = new Date();
    if (parsedIsExpired) {
      filter.$or = [
        { isExpired: true },
        { expiresAt: { $lt: now } }
      ];
    } else {
      filter.$and = [
        { isExpired: false },
        { expiresAt: { $gte: now } }
      ];
    }
  }
  if (parsedIsActive !== undefined) {
    filter.isActive = parsedIsActive;
  }
  if (type !== undefined) {
    filter.type = type;
  }
  if (code !== undefined && code.trim() !== '') {
    filter.code = { $regex: code.trim(), $options: 'i' };
  }

  if (createdFrom || createdTo) {
    filter.createdAt = {};
    if (createdFrom) {
      filter.createdAt.$gte = new Date(createdFrom);
    }
    if (createdTo) {
      filter.createdAt.$lte = new Date(createdTo);
    }
  }

  if (validFrom || validTo) {
    filter.expiresAt = {};
    if (validFrom) {
      filter.expiresAt.$gte = new Date(validFrom);
    }
    if (validTo) {
      filter.expiresAt.$lte = new Date(validTo);
    }
  }

  if (minUsage !== undefined || maxUsage !== undefined) {
    filter.usageCount = {};
    if (minUsage !== undefined) {
      filter.usageCount.$gte = Number(minUsage);
    }
    if (maxUsage !== undefined) {
      filter.usageCount.$lte = Number(maxUsage);
    }
  }

  return filter;
};

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
      const {
        page = '1',
        limit = '10',
        isExpired,
        isActive,
        type,
        code,
        createdFrom,
        createdTo,
        validFrom,
        validTo,
        minUsage,
        maxUsage,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
      const skip = (pageNum - 1) * limitNum;

      const filter = buildCouponFilter(req.query);

      const allowedSortFields = ['createdAt', 'expiresAt', 'usageCount', 'code'];
      const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
      const sortDirection = sortOrder === 'asc' ? 1 : -1;
      const sort = { [sortField]: sortDirection };

      // Get total count
      const total = await Coupon.countDocuments(filter);

      // Get coupons
      const coupons = await Coupon.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum);

      res.status(200).json({
        message: 'Coupons retrieved successfully',
        coupons,
        meta: {
          currentPage: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
          filters: {
            isExpired,
            isActive,
            type,
            code,
            createdFrom,
            createdTo,
            validFrom,
            validTo,
            minUsage,
            maxUsage
          },
          sorting: {
            sortBy: sortField,
            sortOrder: sortDirection === 1 ? 'asc' : 'desc'
          }
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

  // Get coupon stats (uses the same filter builder as getAllCoupons)
  getCouponStats: async (req, res) => {
    try {
      const {
        isExpired,
        isActive,
        type,
        code,
        createdFrom,
        createdTo,
        validFrom,
        validTo,
        minUsage,
        maxUsage
      } = req.query;

      const statsFilter = buildCouponFilter(req.query);

      const now = new Date();

      const [
        totalCoupons,
        activeCoupons,
        inactiveCoupons,
        manuallyExpiredCoupons,
        dateExpiredCoupons,
        randomCoupons,
        customCoupons,
        usageStats,
        topUsedCoupons
      ] = await Promise.all([
        Coupon.countDocuments(statsFilter),
        Coupon.countDocuments({ ...statsFilter, isActive: true }),
        Coupon.countDocuments({ ...statsFilter, isActive: false }),
        Coupon.countDocuments({ ...statsFilter, isExpired: true }),
        Coupon.countDocuments({ ...statsFilter, expiresAt: { $lt: now } }),
        Coupon.countDocuments({ ...statsFilter, type: 'random' }),
        Coupon.countDocuments({ ...statsFilter, type: 'custom' }),
        Coupon.aggregate([
          { $match: statsFilter },
          {
            $group: {
              _id: null,
              totalUsage: { $sum: '$usageCount' },
              averageUsage: { $avg: '$usageCount' },
              maxUsageSeen: { $max: '$usageCount' }
            }
          }
        ]),
        Coupon.find(statsFilter)
          .sort({ usageCount: -1, createdAt: -1 })
          .limit(5)
          .select('code type usageCount isActive isExpired expiresAt')
      ]);

      const usage = usageStats[0] || {
        totalUsage: 0,
        averageUsage: 0,
        maxUsageSeen: 0
      };

      res.status(200).json({
        message: 'Coupon stats retrieved successfully',
        stats: {
          totalCoupons,
          activeCoupons,
          inactiveCoupons,
          manuallyExpiredCoupons,
          dateExpiredCoupons,
          randomCoupons,
          customCoupons,
          totalUsage: usage.totalUsage || 0,
          averageUsage: Number((usage.averageUsage || 0).toFixed(2)),
          maxUsageSeen: usage.maxUsageSeen || 0
        },
        topUsedCoupons,
        filters: {
          isExpired: isExpired ?? null,
          isActive: isActive ?? null,
          type: type ?? null,
          code: code ?? null,
          createdFrom: createdFrom ?? null,
          createdTo: createdTo ?? null,
          validFrom: validFrom ?? null,
          validTo: validTo ?? null,
          minUsage: minUsage ?? null,
          maxUsage: maxUsage ?? null
        }
      });
    } catch (error) {
      console.error('Error fetching coupon stats:', error);
      res.status(500).json({
        message: 'Failed to fetch coupon stats',
        error: error.message
      });
    }
  },

  // Search coupons by name (code)
  searchCouponByName: async (req, res) => {
    try {
      const { name, page = '1', limit = '10' } = req.query;
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
      const skip = (pageNum - 1) * limitNum;

      if (!name || name.trim() === '') {
        return res.status(400).json({
          message: 'Search name is required'
        });
      }

      // Build filter with case-insensitive partial match
      const filter = {
        code: { $regex: name.trim(), $options: 'i' }
      };

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
          totalPages: Math.ceil(total / limitNum),
          searchTerm: name.trim()
        }
      });
    } catch (error) {
      console.error('Error searching coupons:', error);
      res.status(500).json({
        message: 'Failed to search coupons',
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
  },

  /**
   * Mint or reuse a unique single-use exit-intent coupon (public, rate-limited).
   * Called when the user scratches — that is when the coupon is created and the
   * 5-minute checkout window starts.
   * Hard rule: one exit-intent mint per IP per 24 hours.
   */
  createExitIntentCoupon: async (req, res) => {
    const MAX_CODE_ATTEMPTS = 8;

    try {
      const ip = getRealIP(req);
      if (!ip || ip === 'unknown') {
        return res.status(400).json({
          message: 'Unable to identify client for discount offer',
        });
      }

      const latestForIp = await Coupon.findOne({
        mintedForIp: ip,
        description: EXIT_INTENT_DESCRIPTION,
      }).sort({ createdAt: -1 });

      if (latestForIp) {
        const ageMs = Date.now() - new Date(latestForIp.createdAt).getTime();
        const withinDailyLimit = ageMs < EXIT_INTENT_CLAIM_WINDOW_MS;

        if (isUnusedExitIntentReusable(latestForIp)) {
          await startExitIntentClock(latestForIp);
          return res.status(200).json(
            exitIntentSuccessBody(latestForIp, {
              reused: true,
              message: 'Existing exit-intent coupon reused',
            }),
          );
        }

        if (withinDailyLimit) {
          const retryAfterSeconds = Math.max(
            1,
            Math.ceil((EXIT_INTENT_CLAIM_WINDOW_MS - ageMs) / 1000),
          );
          return res.status(429).json({
            valid: false,
            message: EXIT_INTENT_ALREADY_CLAIMED_MESSAGE,
            retryAfter: retryAfterSeconds,
          });
        }
      }

      let code = null;
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
        const candidate = Math.random().toString(36).substring(2, 10).toUpperCase();
        const exists = await Coupon.exists({ code: candidate });
        if (!exists) {
          code = candidate;
          break;
        }
      }

      if (!code) {
        return res.status(500).json({
          message: 'Failed to generate a unique coupon code',
        });
      }

      const expiresAt = new Date(Date.now() + EXIT_INTENT_TTL_MS);
      const coupon = new Coupon({
        type: 'random',
        code,
        percentage: EXIT_INTENT_PERCENTAGE,
        expirationDuration: EXIT_INTENT_TTL_MS / (60 * 60 * 1000),
        expiresAt,
        description: EXIT_INTENT_DESCRIPTION,
        maxUsage: 1,
        isActive: true,
        mintedForIp: ip,
        revealedAt: new Date(),
      });
      await coupon.save();

      const earlier = await Coupon.findOne({
        mintedForIp: ip,
        description: EXIT_INTENT_DESCRIPTION,
        _id: { $ne: coupon._id },
        createdAt: { $gte: new Date(Date.now() - EXIT_INTENT_CLAIM_WINDOW_MS) },
      }).sort({ createdAt: 1 });

      if (earlier) {
        await Coupon.deleteOne({ _id: coupon._id });
        if (isUnusedExitIntentReusable(earlier)) {
          await startExitIntentClock(earlier);
          return res.status(200).json(
            exitIntentSuccessBody(earlier, {
              reused: true,
              message: 'Existing exit-intent coupon reused',
            }),
          );
        }
        return res.status(429).json({
          valid: false,
          message: EXIT_INTENT_ALREADY_CLAIMED_MESSAGE,
        });
      }

      return res.status(201).json(
        exitIntentSuccessBody(coupon, {
          reused: false,
          message: 'Coupon created successfully',
        }),
      );
    } catch (error) {
      console.error('Error creating exit-intent coupon:', error);
      return res.status(500).json({
        message: 'Failed to create exit-intent coupon',
        error: error.message,
      });
    }
  },

  /**
   * Check whether this IP can still claim an exit-intent offer. Does not mint.
   */
  getExitIntentStatus: async (req, res) => {
    try {
      const ip = getRealIP(req);
      if (!ip || ip === 'unknown') {
        return res.status(400).json({
          eligible: false,
          message: 'Unable to identify client for discount offer',
        });
      }

      const latestForIp = await Coupon.findOne({
        mintedForIp: ip,
        description: EXIT_INTENT_DESCRIPTION,
      }).sort({ createdAt: -1 });

      if (!latestForIp) {
        return res.status(200).json({ eligible: true });
      }

      if (isUnusedExitIntentReusable(latestForIp)) {
        return res.status(200).json({ eligible: true });
      }

      const ageMs = Date.now() - new Date(latestForIp.createdAt).getTime();
      if (ageMs < EXIT_INTENT_CLAIM_WINDOW_MS) {
        return res.status(200).json({
          eligible: false,
          message: EXIT_INTENT_ALREADY_CLAIMED_MESSAGE,
        });
      }

      return res.status(200).json({ eligible: true });
    } catch (error) {
      console.error('Error checking exit-intent status:', error);
      return res.status(500).json({
        eligible: false,
        message: 'Failed to check discount offer',
      });
    }
  },

  /**
   * Start the 5-minute checkout window when the user scratches the code.
   * Idempotent: a second reveal returns the same expiresAt.
   */
  revealExitIntentCoupon: async (req, res) => {
    try {
      const ip = getRealIP(req);
      if (!ip || ip === 'unknown') {
        return res.status(400).json({
          message: 'Unable to identify client for discount offer',
        });
      }

      const code = String(req.body?.code || '').trim().toUpperCase();
      if (!code) {
        return res.status(400).json({
          valid: false,
          message: 'Coupon code is required',
        });
      }

      const coupon = await Coupon.findOne({
        code,
        mintedForIp: ip,
        description: EXIT_INTENT_DESCRIPTION,
      });

      if (!coupon) {
        return res.status(404).json({
          valid: false,
          message: 'Coupon not found',
        });
      }

      if ((coupon.usageCount || 0) >= 1) {
        return res.status(400).json({
          valid: false,
          message: 'Coupon has already been used',
        });
      }

      if (coupon.revealedAt) {
        const validation = coupon.validateCoupon(null, null);
        if (!validation.valid) {
          return res.status(200).json({
            valid: false,
            message: validation.message,
            coupon: serializeExitIntentCoupon(coupon),
          });
        }
        return res.status(200).json(
          exitIntentSuccessBody(coupon, {
            reused: true,
            message: 'Coupon already unlocked',
          }),
        );
      }

      const ageMs = Date.now() - new Date(coupon.createdAt).getTime();
      if (ageMs >= EXIT_INTENT_CLAIM_WINDOW_MS) {
        return res.status(400).json({
          valid: false,
          message: 'Coupon has expired',
        });
      }

      coupon.revealedAt = new Date();
      coupon.expiresAt = new Date(Date.now() + EXIT_INTENT_TTL_MS);
      coupon.expirationDuration = EXIT_INTENT_TTL_MS / (60 * 60 * 1000);
      await coupon.save();

      return res.status(200).json(
        exitIntentSuccessBody(coupon, {
          reused: false,
          message: 'Coupon unlocked',
        }),
      );
    } catch (error) {
      console.error('Error revealing exit-intent coupon:', error);
      return res.status(500).json({
        message: 'Failed to unlock discount code',
        error: error.message,
      });
    }
  },
};

module.exports = couponCtrl;
