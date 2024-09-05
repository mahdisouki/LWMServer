const jwt = require('jsonwebtoken');
const { User } = require('../models/User');


exports.isAuth = async (req, res, next) => {
  if (req.headers && req.headers.authorization) {
    const token = req.headers.authorization.split(' ')[1]; 

    try {
      const decode = jwt.verify(token, process.env.JWT_SECRET); 
      const user = await User.findById(decode.userId);

      if (!user) { 
        console.log("User not found with the provided token");
        return res.status(401).json({ success: false, message: 'Unauthorized access!' });
      }

      req.user = user; 
      next(); 
    } catch (error) {
      if (error.name === 'JsonWebTokenError') { 
        console.log("JWT error:", error.message);
        return res.status(401).json({ success: false, message: 'Unauthorized access!' });
      }
      if (error.name === 'TokenExpiredError') { 
        console.log("Token expired:", error.message);
        return res.status(401).json({
          success: false,
          message: 'Session expired, please sign in again!',
        });
      }
      console.error("Internal server error:", error.message); 
      res.status(500).json({ success: false, message: 'Internal server error!' });
    }
  } else {
    console.log("No authorization header found");
    res.status(401).json({ success: false, message: 'Unauthorized access!' });
  }
};

exports.verifyRefreshToken = (req, res, next) => {
  const { token: refreshToken } = req.body;

  if (!refreshToken) { 
    console.log("Refresh token required");
    return res.status(401).json({ success: false, message: "Refresh token required" });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET); // Verify the refresh token
    req.user = decoded; 
    next(); 
  } catch (error) {
    console.error("Invalid refresh token:", error.message);
    res.status(403).json({ success: false, message: "Invalid refresh token" });
  }
};
