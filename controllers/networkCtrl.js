const mongoose = require('mongoose');
const { User } = require('../models/User');
const Session = require('../models/Session');
const loggingService = require('../services/loggingService');
const sessionService = require('../services/sessionService');

function getIsUserOnline() {
  try {
    const { isUserOnline } = require('../socket');
    return isUserOnline;
  } catch {
    return () => false;
  }
}

exports.listActiveSessions = async (req, res) => {
  try {
    const { role, online, q } = req.query;
    const sessions = await sessionService.listActiveSessions({
      role,
      online,
      q,
      isUserOnline: getIsUserOnline(),
    });

    res.json({
      success: true,
      count: sessions.length,
      sessions,
    });
  } catch (error) {
    console.error('Error listing active sessions:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getSessionHistory = async (req, res) => {
  try {
    const { page, limit, userId, from, to, status } = req.query;

    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid userId' });
    }

    const result = await sessionService.getSessionHistory({
      page,
      limit,
      userId,
      from,
      to,
      status,
      isUserOnline: getIsUserOnline(),
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error fetching session history:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getUserSessions = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid userId' });
    }

    const user = await User.findById(userId).select('_id username email');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const sessions = await sessionService.getUserSessions(userId, {
      isUserOnline: getIsUserOnline(),
    });

    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
      count: sessions.length,
      sessions,
    });
  } catch (error) {
    console.error('Error fetching user sessions:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.revokeSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid sessionId' });
    }

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    if (String(session.userId) === String(req.user._id) && session.status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'You cannot revoke your own active session. Please use the logout endpoint.',
      });
    }

    const targetUser = await User.findById(session.userId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const wasActive = session.status === 'active';
    await sessionService.revokeSessionById(sessionId, { revokedBy: req.user._id });

    let kicked = false;
    const matchesCurrentRefresh =
      targetUser.refreshToken &&
      sessionService.hashRefreshToken(targetUser.refreshToken) === session.refreshTokenHash;

    if (wasActive && matchesCurrentRefresh) {
      await sessionService.clearUserAuthState(targetUser);
      kicked = await sessionService.forceKickUser(
        targetUser._id,
        'Your session has been revoked by an administrator.'
      );
    }

    try {
      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'LOGOUT',
        entityType: 'USER',
        entityId: targetUser._id,
        changes: {
          loggedOutBy: {
            adminId: req.user._id,
            adminUsername: req.user.username,
            targetUserId: targetUser._id,
            targetUsername: targetUser.username,
            sessionId,
            disconnectedFromSocket: kicked,
            scope: 'single-session',
          },
        },
        ipAddress: sessionService.getRealIP(req),
        userAgent: req.headers['user-agent'],
      });
    } catch (logError) {
      console.error('Failed to write session revoke log:', logError);
    }

    res.json({
      success: true,
      message: 'Session revoked successfully',
      kicked,
    });
  } catch (error) {
    console.error('Error revoking session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.revokeAllUserSessions = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid userId' });
    }

    if (String(req.user._id) === String(userId)) {
      return res.status(400).json({
        success: false,
        message: 'You cannot log yourself out. Please use the logout endpoint.',
      });
    }

    const userToLogout = await User.findById(userId);
    if (!userToLogout) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await sessionService.revokeAllForUser(userId, { revokedBy: req.user._id });
    await sessionService.clearUserAuthState(userToLogout);
    const disconnected = await sessionService.forceKickUser(
      userId,
      'You have been logged out from all devices by an administrator.'
    );

    try {
      await loggingService.createLog({
        userId: req.user._id,
        username: req.user.username,
        action: 'LOGOUT',
        entityType: 'USER',
        entityId: userId,
        changes: {
          loggedOutBy: {
            adminId: req.user._id,
            adminUsername: req.user.username,
            targetUserId: userId,
            targetUsername: userToLogout.username,
            disconnectedFromSocket: disconnected,
            scope: 'all-sessions',
          },
        },
        ipAddress: sessionService.getRealIP(req),
        userAgent: req.headers['user-agent'],
      });
    } catch (logError) {
      console.error('Failed to write revoke-all log:', logError);
    }

    res.json({
      success: true,
      message: 'User logged out from all devices successfully',
      disconnected,
    });
  } catch (error) {
    console.error('Error revoking all sessions:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
