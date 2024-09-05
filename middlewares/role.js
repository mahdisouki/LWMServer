exports.checkRole = (role) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }


  if (!req.user.role.includes(role)) {
    return res.status(403).json({ success: false, message: "Forbidden: Insufficient permissions" });
  }

  next();
};
 
  