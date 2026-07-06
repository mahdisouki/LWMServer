const clarityService = require('../services/clarity/clarityService');
const claritySnapshotService = require('../services/clarity/claritySnapshotService');

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
      const snapshotDate = req.body?.snapshotDate ? new Date(req.body.snapshotDate) : new Date();
      if (Number.isNaN(snapshotDate.getTime())) {
        return res.status(400).json({ message: 'Invalid snapshotDate' });
      }
      const result = await claritySnapshotService.syncDailySnapshots({ snapshotDate });
      res.status(200).json({
        message: 'Clarity snapshots synced successfully',
        ...result,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to sync Clarity snapshots', error: error.message });
    }
  },
};

module.exports = clarityCtrl;
