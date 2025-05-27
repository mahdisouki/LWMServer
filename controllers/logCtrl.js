const loggingService = require('../services/loggingService');

const logCtrl = {
  async getLogs(req, res) {
    try {
      const { page = 1, limit = 10, ...filters } = req.query;
      const result = await loggingService.getLogs(filters, parseInt(page), parseInt(limit));
      
      res.status(200).json({
        message: 'Logs retrieved successfully',
        ...result
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve logs',
        error: error.message
      });
    }
  },

  async getLogsByEntity(req, res) {
    try {
      const { entityType, entityId } = req.params;
      const { page = 1, limit = 10 } = req.query;
      
      const result = await loggingService.getLogsByEntity(
        entityType,
        entityId,
        parseInt(page),
        parseInt(limit)
      );
      
      res.status(200).json({
        message: 'Entity logs retrieved successfully',
        ...result
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve entity logs',
        error: error.message
      });
    }
  }
};

module.exports = logCtrl; 