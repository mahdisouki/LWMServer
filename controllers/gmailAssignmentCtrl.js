const {
  listAdminsWithPresence,
  getAssignmentStatusForAdmin,
  setAssignmentActiveForAdmin,
  touchAssignmentActivity,
  reassignThread,
} = require('../services/gmailAssignmentService');

function statusFromError(error) {
  return error.status || error.statusCode || 500;
}

const gmailAssignmentCtrl = {
  listAdminPresence: async (req, res) => {
    try {
      const admins = await listAdminsWithPresence();
      res.json({
        success: true,
        admins,
        activeCount: admins.filter((a) => a.assignmentActive).length,
        onlineCount: admins.filter((a) => a.assignmentActive).length,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to list assignment admins',
        error: error.message,
      });
    }
  },

  getMyAssignmentStatus: async (req, res) => {
    try {
      const status = await getAssignmentStatusForAdmin(req.user._id);
      res.json({ success: true, ...status });
    } catch (error) {
      res.status(statusFromError(error)).json({
        success: false,
        message: error.message || 'Failed to load assignment status',
        error: error.message,
      });
    }
  },

  setMyAssignmentActive: async (req, res) => {
    try {
      if (typeof req.body?.active !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'active (boolean) is required',
        });
      }
      const status = await setAssignmentActiveForAdmin(req.user._id, req.body.active);
      res.json({ success: true, ...status });
    } catch (error) {
      res.status(statusFromError(error)).json({
        success: false,
        message: error.message || 'Failed to update assignment status',
        error: error.message,
      });
    }
  },

  recordActivity: async (req, res) => {
    try {
      const result = await touchAssignmentActivity(req.user._id);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to record activity',
        error: error.message,
      });
    }
  },

  reassign: async (req, res) => {
    try {
      const toAdminId = req.body.toAdminId || req.body.adminId;
      if (!toAdminId) {
        return res.status(400).json({
          success: false,
          message: 'toAdminId is required',
        });
      }
      const assignment = await reassignThread({
        threadId: req.params.threadId,
        mailboxEmail: req.body.mailboxEmail || req.query.mailboxEmail,
        toAdminId,
        fromAdminId: req.user._id,
        note: req.body.note,
      });
      res.json({ success: true, assignment });
    } catch (error) {
      res.status(statusFromError(error)).json({
        success: false,
        message: error.message || 'Failed to reassign',
        error: error.message,
      });
    }
  },
};

module.exports = gmailAssignmentCtrl;
