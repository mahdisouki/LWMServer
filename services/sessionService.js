const crypto = require('crypto');
const Session = require('../models/Session');
const { lookupIpLocation } = require('../utils/geoLookup');

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function getRealIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown'
  );
}

function summarizeDevice(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'Unknown device';

  const lower = ua.toLowerCase();
  if (lower.includes('okhttp') || lower.includes('dalvik') || lower.includes('android')) {
    return 'Android app';
  }
  if (lower.includes('cfnetwork') || lower.includes('darwin') || /iphone|ipad|ios/.test(lower)) {
    if (lower.includes('mobile') || lower.includes('iphone') || lower.includes('ipad')) {
      return 'iOS app / Safari';
    }
  }

  let browser = 'Browser';
  if (lower.includes('edg/')) browser = 'Edge';
  else if (lower.includes('chrome/')) browser = 'Chrome';
  else if (lower.includes('firefox/')) browser = 'Firefox';
  else if (lower.includes('safari/') && !lower.includes('chrome')) browser = 'Safari';

  let os = 'Unknown OS';
  if (lower.includes('windows')) os = 'Windows';
  else if (lower.includes('mac os') || lower.includes('macintosh')) os = 'macOS';
  else if (lower.includes('android')) os = 'Android';
  else if (lower.includes('linux')) os = 'Linux';
  else if (lower.includes('iphone') || lower.includes('ipad')) os = 'iOS';

  return `${browser} / ${os}`;
}

function resolveRoleSnapshot(user) {
  if (user.roleType) return user.roleType;
  if (Array.isArray(user.role) && user.role.length) return user.role[0];
  return null;
}

function formatSession(sessionDoc, { online = false, user = null } = {}) {
  const session = sessionDoc.toObject ? sessionDoc.toObject() : sessionDoc;
  const populatedUser = user || session.userId;

  let userPayload = null;
  if (populatedUser && typeof populatedUser === 'object' && populatedUser._id) {
    userPayload = {
      id: populatedUser._id,
      username: populatedUser.username,
      email: populatedUser.email,
      role: populatedUser.roleType || (Array.isArray(populatedUser.role) ? populatedUser.role[0] : populatedUser.role),
      picture: populatedUser.picture || null,
    };
  }

  return {
    id: session._id,
    user: userPayload,
    userId: userPayload ? userPayload.id : session.userId,
    ip: session.ip,
    location: session.location || {},
    userAgent: session.userAgent,
    deviceSummary: session.deviceSummary,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    revokedAt: session.revokedAt || null,
    status: session.status,
    roleSnapshot: session.roleSnapshot,
    online: Boolean(online),
  };
}

async function createSession({ user, refreshToken, req }) {
  const ip = getRealIP(req);
  const userAgent = req.headers['user-agent'] || '';
  const now = new Date();

  await Session.updateMany(
    { userId: user._id, status: 'active' },
    { $set: { status: 'superseded', revokedAt: now } }
  );

  const session = await Session.create({
    userId: user._id,
    refreshTokenHash: hashRefreshToken(refreshToken),
    ip,
    userAgent,
    deviceSummary: summarizeDevice(userAgent),
    location: lookupIpLocation(ip),
    lastActiveAt: now,
    status: 'active',
    roleSnapshot: resolveRoleSnapshot(user),
  });

  user.lastLoginAt = now;
  user.lastLoginIp = ip;

  return session;
}

async function touchSession({ oldRefreshToken, newRefreshToken }) {
  if (!oldRefreshToken || !newRefreshToken) return null;

  const session = await Session.findOne({
    refreshTokenHash: hashRefreshToken(oldRefreshToken),
    status: 'active',
  });

  if (!session) return null;

  session.refreshTokenHash = hashRefreshToken(newRefreshToken);
  session.lastActiveAt = new Date();
  await session.save();
  return session;
}

async function revokeSessionByRefreshToken(refreshToken, { revokedBy = null } = {}) {
  if (!refreshToken) return null;

  const session = await Session.findOne({
    refreshTokenHash: hashRefreshToken(refreshToken),
    status: 'active',
  });

  if (!session) return null;

  session.status = 'revoked';
  session.revokedAt = new Date();
  if (revokedBy) session.revokedBy = revokedBy;
  await session.save();
  return session;
}

async function revokeSessionById(sessionId, { revokedBy = null } = {}) {
  const session = await Session.findById(sessionId);
  if (!session) return null;
  if (session.status !== 'active') return session;

  session.status = 'revoked';
  session.revokedAt = new Date();
  if (revokedBy) session.revokedBy = revokedBy;
  await session.save();
  return session;
}

async function revokeAllForUser(userId, { revokedBy = null } = {}) {
  const now = new Date();
  const result = await Session.updateMany(
    { userId, status: 'active' },
    {
      $set: {
        status: 'revoked',
        revokedAt: now,
        ...(revokedBy ? { revokedBy } : {}),
      },
    }
  );
  return result;
}

async function findActiveSessionMatchingRefresh(user) {
  if (!user?.refreshToken) return null;
  return Session.findOne({
    userId: user._id,
    refreshTokenHash: hashRefreshToken(user.refreshToken),
    status: 'active',
  });
}

async function listActiveSessions({ role, online, q, isUserOnline } = {}) {
  const sessions = await Session.find({ status: 'active' })
    .sort({ lastActiveAt: -1 })
    .populate('userId', 'username email role roleType picture')
    .lean();

  let filtered = sessions.filter((s) => s.userId);

  if (role) {
    const roleLower = String(role).toLowerCase();
    filtered = filtered.filter((s) => {
      const r =
        s.roleSnapshot ||
        s.userId.roleType ||
        (Array.isArray(s.userId.role) ? s.userId.role[0] : s.userId.role);
      return String(r || '').toLowerCase() === roleLower;
    });
  }

  if (q) {
    const needle = String(q).trim().toLowerCase();
    filtered = filtered.filter((s) => {
      const username = String(s.userId.username || '').toLowerCase();
      const email = String(s.userId.email || '').toLowerCase();
      return username.includes(needle) || email.includes(needle);
    });
  }

  let formatted = filtered.map((s) => {
    const userId = s.userId._id;
    const isOnline = typeof isUserOnline === 'function' ? isUserOnline(userId) : false;
    return formatSession(s, { online: isOnline, user: s.userId });
  });

  if (online === 'true' || online === true) {
    formatted = formatted.filter((s) => s.online);
  } else if (online === 'false' || online === false) {
    formatted = formatted.filter((s) => !s.online);
  }

  return formatted;
}

async function getSessionHistory({
  page = 1,
  limit = 20,
  userId,
  from,
  to,
  status,
  isUserOnline,
} = {}) {
  const query = {};

  if (userId) query.userId = userId;
  if (status) query.status = status;

  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to) query.createdAt.$lte = new Date(to);
  }

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;

  const [total, sessions] = await Promise.all([
    Session.countDocuments(query),
    Session.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate('userId', 'username email role roleType picture')
      .populate('revokedBy', 'username email')
      .lean(),
  ]);

  const items = sessions.map((s) => {
    const uid = s.userId?._id || s.userId;
    const isOnline = typeof isUserOnline === 'function' ? isUserOnline(uid) : false;
    const formatted = formatSession(s, { online: isOnline, user: s.userId });
    if (s.revokedBy && typeof s.revokedBy === 'object') {
      formatted.revokedBy = {
        id: s.revokedBy._id,
        username: s.revokedBy.username,
        email: s.revokedBy.email,
      };
    }
    return formatted;
  });

  return {
    sessions: items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  };
}

async function getUserSessions(userId, { isUserOnline } = {}) {
  const sessions = await Session.find({ userId })
    .sort({ createdAt: -1 })
    .populate('userId', 'username email role roleType picture')
    .populate('revokedBy', 'username email')
    .lean();

  return sessions.map((s) => {
    const uid = s.userId?._id || s.userId;
    const isOnline = typeof isUserOnline === 'function' ? isUserOnline(uid) : false;
    const formatted = formatSession(s, { online: isOnline, user: s.userId });
    if (s.revokedBy && typeof s.revokedBy === 'object') {
      formatted.revokedBy = {
        id: s.revokedBy._id,
        username: s.revokedBy.username,
        email: s.revokedBy.email,
      };
    }
    return formatted;
  });
}

async function forceKickUser(userId, message) {
  const { getIo, disconnectUser } = require('../socket');
  let disconnected = false;

  try {
    const io = getIo();
    if (io) {
      const userIdStr = String(userId);
      for (const [, socket] of io.sockets.sockets) {
        if (socket.user?.userId && String(socket.user.userId) === userIdStr) {
          socket.emit('forceLogout', {
            message: message || 'You have been logged out by an administrator.',
            timestamp: new Date(),
          });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (socketError) {
    console.error('Error emitting forceLogout:', socketError);
  }

  try {
    disconnected = disconnectUser(userId);
  } catch (disconnectError) {
    console.error('Error disconnecting user:', disconnectError);
  }

  return disconnected;
}

async function clearUserAuthState(user) {
  user.refreshToken = undefined;
  user.devices = [];
  user.oneSignalPlayerIds = [];
  user.oneSignalPlayerId = undefined;
  user.oneSignalWebPlayerIds = [];
  user.oneSignalWebPlayerId = undefined;
  user.fcmToken = undefined;
  user.apnsToken = undefined;
  await user.save();
}

module.exports = {
  hashRefreshToken,
  getRealIP,
  summarizeDevice,
  formatSession,
  createSession,
  touchSession,
  revokeSessionByRefreshToken,
  revokeSessionById,
  revokeAllForUser,
  findActiveSessionMatchingRefresh,
  listActiveSessions,
  getSessionHistory,
  getUserSessions,
  forceKickUser,
  clearUserAuthState,
};
