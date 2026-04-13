const InterestTracking = require('../models/InterestTracking');

const analyticsCtrl = {
  /**
   * Track user interest when clicking on disabled items
   * POST /api/analytics/interest-tracking
   */
  trackInterest: async (req, res) => {
    try {
      const { type, date, metadata } = req.body;

      // Validate required fields
      if (!type || !date) {
        return res.status(400).json({
          message: 'Type and date are required fields'
        });
      }

      // Validate type enum
      const validTypes = ['sunday_click', 'night_slot_click'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          message: `Type must be one of: ${validTypes.join(', ')}`
        });
      }

      // Validate date
      const trackingDate = new Date(date);
      if (isNaN(trackingDate.getTime())) {
        return res.status(400).json({
          message: 'Invalid date format'
        });
      }

      // Create interest tracking record
      const interestRecord = new InterestTracking({
        type,
        date: trackingDate,
        metadata: metadata || {},
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip || req.connection.remoteAddress
      });

      await interestRecord.save();

      res.status(201).json({
        message: 'Interest tracked successfully',
        data: interestRecord
      });
    } catch (error) {
      console.error('Error tracking interest:', error);
      res.status(500).json({
        message: 'Failed to track interest',
        error: error.message
      });
    }
  },

  /**
   * Get aggregated analytics data
   * GET /api/analytics/interest-analytics
   * Query params:
   * - date: single business date (optional)
   * - startDate, endDate: createdAt date range (optional)
   * - type: sundays | night_shift (optional, supports comma-separated values)
   * - page, limit: pagination for dailyBreakdown (optional)
   */
  getInterestAnalytics: async (req, res) => {
    try {
      const { date, startDate, endDate, type } = req.query;
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 200);
      const skip = (page - 1) * limit;

      // Build filter:
      // - date => business date (single day)
      // - startDate/endDate => createdAt range
      const matchFilter = {};
      const typeMap = {
        sundays: 'sunday_click',
        sunday_click: 'sunday_click',
        night_shift: 'night_slot_click',
        'night shift': 'night_slot_click',
        night_slot_click: 'night_slot_click'
      };

      if (type) {
        const requestedTypes = String(type)
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean);

        const mappedTypes = requestedTypes.map((item) => typeMap[item]);
        const invalidTypes = requestedTypes.filter((_, idx) => !mappedTypes[idx]);

        if (invalidTypes.length > 0) {
          return res.status(400).json({
            message: 'Invalid type filter. Use: sundays, night_shift'
          });
        }

        const uniqueTypes = [...new Set(mappedTypes)];
        matchFilter.type = uniqueTypes.length === 1 ? uniqueTypes[0] : { $in: uniqueTypes };
      }

      if (date) {
        const businessDate = new Date(date);
        if (isNaN(businessDate.getTime())) {
          return res.status(400).json({
            message: 'Invalid business date format'
          });
        }

        const dayStart = new Date(businessDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(businessDate);
        dayEnd.setHours(23, 59, 59, 999);

        matchFilter.date = { $gte: dayStart, $lte: dayEnd };
      }

      if (startDate || endDate) {
        matchFilter.createdAt = {};
        if (startDate) {
          const createdStart = new Date(startDate);
          if (isNaN(createdStart.getTime())) {
            return res.status(400).json({
              message: 'Invalid startDate format'
            });
          }
          matchFilter.createdAt.$gte = createdStart;
        }
        if (endDate) {
          const createdEnd = new Date(endDate);
          if (isNaN(createdEnd.getTime())) {
            return res.status(400).json({
              message: 'Invalid endDate format'
            });
          }
          createdEnd.setHours(23, 59, 59, 999); // Include entire end date
          matchFilter.createdAt.$lte = createdEnd;
        }
      }

      // Aggregate data by type
      const aggregation = await InterestTracking.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            dates: { $push: '$date' },
            firstSeen: { $min: '$createdAt' },
            lastSeen: { $max: '$createdAt' }
          }
        },
        {
          $project: {
            _id: 0,
            type: '$_id',
            count: 1,
            firstSeen: 1,
            lastSeen: 1,
            uniqueDates: { $size: { $setUnion: ['$dates'] } },
            firstCreatedAt: '$firstSeen',
            lastCreatedAt: '$lastSeen',
            uniqueBusinessDates: { $size: { $setUnion: ['$dates'] } }
          }
        }
      ]);

      // Get total count
      const totalCount = await InterestTracking.countDocuments(matchFilter);

      // Build daily breakdown filter from active query filters only.
      const dailyMatch = { ...matchFilter };

      const baseDailyPipeline = [
        { $match: dailyMatch },
        {
          $group: {
            _id: {
              type: '$type',
              createdAtDate: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
              },
              businessDate: {
                $dateToString: { format: '%Y-%m-%d', date: '$date' }
              }
            },
            count: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: '$_id.createdAtDate',
            businessDates: { $addToSet: '$_id.businessDate' },
            clicks: {
              $push: {
                type: '$_id.type',
                count: '$count',
                businessDate: '$_id.businessDate'
              }
            },
            total: { $sum: '$count' }
          }
        },
        { $sort: { _id: -1 } }
      ];

      const [dailyCountResult, dailyBreakdown] = await Promise.all([
        InterestTracking.aggregate([
          ...baseDailyPipeline,
          { $count: 'totalItems' }
        ]),
        InterestTracking.aggregate([
          ...baseDailyPipeline,
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              createdAtDate: '$_id',
              businessDates: 1,
              clicks: 1,
              total: 1
            }
          }
        ])
      ]);

      const totalDailyItems = dailyCountResult[0]?.totalItems || 0;
      const totalPages = Math.ceil(totalDailyItems / limit) || 0;

      res.status(200).json({
        message: 'Analytics retrieved successfully',
        data: {
          summary: aggregation,
          totalCount,
          dailyBreakdown,
          pagination: {
            page,
            limit,
            totalItems: totalDailyItems,
            totalPages
          }
        }
      });
    } catch (error) {
      console.error('Error getting analytics:', error);
      res.status(500).json({
        message: 'Failed to retrieve analytics',
        error: error.message
      });
    }
  }
};

module.exports = analyticsCtrl;

