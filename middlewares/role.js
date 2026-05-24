exports.checkRole = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const roles = allowedRoles.flat().filter(Boolean);
  if (!roles.length) {
    return res.status(500).json({ success: false, message: 'Role check misconfigured' });
  }

  const roleType = req.user.roleType;
  const userRoles = Array.isArray(req.user.role) ? req.user.role : [];
  const hasRole =
    roles.includes(roleType) || roles.some((r) => userRoles.includes(r));

  if (!hasRole) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Insufficient permissions',
    });
  }

  next();
};
