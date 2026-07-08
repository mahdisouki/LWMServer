const clarityService = require('../services/clarity/clarityService');
const claritySnapshotService = require('../services/clarity/claritySnapshotService');
const ClarityManualSync = require('../models/ClarityManualSync');

const CLARITY_CRON_TIMEZONE = process.env.CLARITY_CRON_TIMEZONE || 'Europe/London';

function dayKeyInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

const clarityCtrl = {
  getOverview: async (req, res) => {
    try {
      const numOfDays = parseInt(req.query.days, 10) || 1;
      const data = await clarityService.getOverview(numOfDays);
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load Clarity overview', error: error.message });
    }
  },

  getTopPages: async (req, res) => {
    try {
      const numOfDays = parseInt(req.query.days, 10) || 3;
      const data = await clarityService.getTopPages(numOfDays);
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load top pages', error: error.message });
    }
  },

  getTrafficSources: async (req, res) => {
    try {
      const numOfDays = parseInt(req.query.days, 10) || 3;
      const data = await clarityService.getTrafficSources(numOfDays);
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load traffic sources', error: error.message });
    }
  },

  getDeviceBreakdown: async (req, res) => {
    try {
      const numOfDays = parseInt(req.query.days, 10) || 3;
      const data = await clarityService.getDeviceBreakdown(numOfDays);
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load device breakdown', error: error.message });
    }
  },

  getCustom: async (req, res) => {
    try {
      const { days, dimension1, dimension2, dimension3 } = req.query;
      const data = await clarityService.fetchProjectLiveInsights({
        numOfDays: parseInt(days, 10) || 1,
        dimension1,
        dimension2,
        dimension3,
      });
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load Clarity data', error: error.message });
    }
  },

  getHistory: async (req, res) => {
    try {
      const result = await claritySnapshotService.getSnapshotHistory({
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        snapshotType: req.query.type,
        page: req.query.page,
        limit: req.query.limit,
      });
      res.status(200).json({
        message: 'Clarity history retrieved successfully',
        ...result,
      });
    } catch (error) {
      res.status(400).json({ message: 'Failed to load Clarity history', error: error.message });
    }
  },

  triggerSync: async (req, res) => {
    try {
      const dayKey = dayKeyInTimeZone(new Date(), CLARITY_CRON_TIMEZONE);
      const existingManualSync = await ClarityManualSync.findOne({ dayKey }).select('_id createdAt').lean();
      if (existingManualSync) {
        return res.status(429).json({
          message: `Manual sync already used for ${dayKey} (${CLARITY_CRON_TIMEZONE})`,
          dayKey,
        });
      }

      const snapshotDate = req.body?.snapshotDate ? new Date(req.body.snapshotDate) : new Date();
      if (Number.isNaN(snapshotDate.getTime())) {
        return res.status(400).json({ message: 'Invalid snapshotDate' });
      }
      const result = await claritySnapshotService.syncDailySnapshots({ snapshotDate });
      await ClarityManualSync.create({
        dayKey,
        timezone: CLARITY_CRON_TIMEZONE,
        snapshotDate: result.snapshotDate,
        synced: result.synced,
        triggeredBy: req.user?._id || null,
      });
      res.status(200).json({
        message: 'Clarity snapshots synced successfully',
        ...result,
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(429).json({
          message: 'Manual sync already used for today',
          timezone: CLARITY_CRON_TIMEZONE,
        });
      }
      res.status(500).json({ message: 'Failed to sync Clarity snapshots', error: error.message });
    }
  },
};

module.exports = clarityCtrl;
