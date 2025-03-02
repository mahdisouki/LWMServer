exports.checkPermissions = (resource, action) => async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
  
    // Ensure the user is an Admin with permissions
    if (req.user.role !== 'Admin' || !req.user.permissions) {
      return res.status(403).json({ success: false, message: "Forbidden: Insufficient permissions" });
    }
  
    // Check if the user has the required permission
    const userPermissions = req.user.permissions[resource] || [];
    if (!userPermissions.includes(action)) {
      return res.status(403).json({ success: false, message: `Forbidden: You do not have ${action} permission for ${resource}` });
    }
  
    next();
  };
  