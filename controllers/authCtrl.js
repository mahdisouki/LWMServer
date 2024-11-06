
const { User } = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Driver = require('../models/Driver');
const Helper = require('../models/Helper');
const Truck = require('../models/Truck');
require('dotenv').config();


const generateAccessToken = (user) => {
  return jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1d" });
};

const generateRefreshToken = (user) => {
  return jwt.sign({ userId: user._id }, process.env.REFRESH_SECRET, { expiresIn: "7d" });
};

exports.userSignIn = async (req, res) => {
  console.log("Signing in user...");
  const { email, password } = req.body;

  try {
    console.log(await User.find());
    const user = await User.findOne({ email });
    
    if (!user) {
      console.log("User not found with the given email!");
      return res.status(404).json({ success: false, message: "User not found with the given email!" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("Password is incorrect!");
      return res.status(401).json({ success: false, message: "Password is incorrect!" });
    }

    console.log("Password matched, generating tokens.");
  
    const token = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    user.refreshToken = refreshToken;
    await user.save();

    let startTime = null;
    let truck = null;

    if (user.role[0] === 'Driver') {
      console.log("User is a driver");
      const driver = await Driver.findById(user._id);
      //check if driver start time have passed 9
      startTime = driver ? driver.startTime : null;
      
      truck = await Truck.findOne({ driverId: user._id }).populate('tasks');
    } else if (user.role[0] === 'Helper') {
      console.log("User is a helper");
      const helper = await Helper.findById(user._id);
      startTime = helper ? helper.startTime : null;
    
      truck = await Truck.findOne({ helperId: user._id }).populate('tasks');
    }

    console.log("User signed in successfully", user);

    res.json({
      success: true,
      user: { 
        ...user._doc,
        id: user._id,
        startTime,
        phoneNumber: user.phoneNumber[0], 
        truckId : truck ? truck._id : null,
        picture: user.picture || null,
      },
      token,
      refreshToken,
    });
  } catch (error) {
    console.error("Error while signing in:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};


exports.refresh = async (req, res) => {
  const refreshToken = req.body.token;
  if (!refreshToken) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "No user found" });
    }

    if (user.refreshToken !== refreshToken) {
      return res.status(403).json({ success: false, message: "Invalid refresh token" });
    }

    const newToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    user.refreshToken = newRefreshToken;
    await user.save();

    res.status(200).json({ success: true, token: newToken, refreshToken: newRefreshToken });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      res.status(403).json({ success: false, message: "Refresh token expired" });
    } else {
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
};





