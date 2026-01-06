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
   * Query params: startDate, endDate (optional)
   */
  getInterestAnalytics: async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      // Build date filter
      const dateFilter = {};
      if (startDate || endDate) {
        dateFilter.date = {};
        if (startDate) {
          dateFilter.date.$gte = new Date(startDate);
        }
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999); // Include entire end date
          dateFilter.date.$lte = end;
        }
      }

      // Aggregate data by type
      const aggregation = await InterestTracking.aggregate([
        { $match: dateFilter },
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
            uniqueDates: { $size: { $setUnion: ['$dates'] } }
          }
        }
      ]);

      // Get total count
      const totalCount = await InterestTracking.countDocuments(dateFilter);

      // Get daily breakdown for the last 30 days if no date filter
      let dailyBreakdown = [];
      if (!startDate && !endDate) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        dailyBreakdown = await InterestTracking.aggregate([
          {
            $match: {
              ...dateFilter,
              createdAt: { $gte: thirtyDaysAgo }
            }
          },
          {
            $group: {
              _id: {
                type: '$type',
                date: {
                  $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                }
              },
              count: { $sum: 1 }
            }
          },
          {
            $group: {
              _id: '$_id.date',
              clicks: {
                $push: {
                  type: '$_id.type',
                  count: '$count'
                }
              },
              total: { $sum: '$count' }
            }
          },
          { $sort: { _id: -1 } },
          {
            $project: {
              _id: 0,
              date: '$_id',
              clicks: 1,
              total: 1
            }
          }
        ]);
      }

      res.status(200).json({
        message: 'Analytics retrieved successfully',
        data: {
          summary: aggregation,
          totalCount,
          dailyBreakdown
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

