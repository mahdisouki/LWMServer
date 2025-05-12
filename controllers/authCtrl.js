const { User } = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Driver = require('../models/Driver');
const Helper = require('../models/Helper');
const Truck = require('../models/Truck');
require('dotenv').config();

const generateAccessToken = (user) => {
  return jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
    expiresIn: '1d',
  });
};

const generateRefreshToken = (user) => {
  return jwt.sign({ userId: user._id }, process.env.REFRESH_SECRET, {
    expiresIn: '7d',
  });
};

exports.userSignIn = async (req, res) => {
  console.log('Signing in user...');
  const { email, password } = req.body;

  try {
    // Step 1: Find user without validation
    let user = await User.findOne({ email }).lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found with the given email!' });
    }

    // Step 2: Fix invalid phoneNumber format
    if (Array.isArray(user.phoneNumber)) {
      console.warn('Fixing phoneNumber format from array to string.');
      user.phoneNumber = user.phoneNumber[0] || '';
      // Update in DB directly
      await User.updateOne({ _id: user._id }, { phoneNumber: user.phoneNumber });
    }

    // Step 3: Re-fetch user as Mongoose document
    const userDoc = await User.findById(user._id);

    const isMatch = await bcrypt.compare(password, userDoc.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Password is incorrect!' });
    }

    const token = generateAccessToken(userDoc);
    const refreshToken = generateRefreshToken(userDoc);
    userDoc.refreshToken = refreshToken;
    await userDoc.save();

    let startTime = null;
    let truck = null;

    if (userDoc.role[0] === 'Driver') {
      const driver = await Driver.findById(userDoc._id);
      startTime = driver ? driver.startTime : null;
      truck = await Truck.findOne({ driverId: userDoc._id }).populate('tasks');
    } else if (userDoc.role[0] === 'Helper') {
      const helper = await Helper.findById(userDoc._id);
      startTime = helper ? helper.startTime : null;
      truck = await Truck.findOne({ helperId: userDoc._id }).populate('tasks');
    }

    return res.json({
      success: true,
      user: {
        ...userDoc.toObject(),
        id: userDoc._id,
        startTime,
        phoneNumber: userDoc.phoneNumber,
        truckId: truck ? truck._id : null,
        picture: userDoc.picture || null,
        permissions: userDoc.permissions || null,
      },
      token,
      refreshToken,
    });

  } catch (error) {
    console.error('Error while signing in:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};



exports.refresh = async (req, res) => {
  const refreshToken = req.body.token;
  if (!refreshToken) {
    return res
      .status(401)
      .json({ success: false, message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'No user found' });
    }

    if (user.refreshToken !== refreshToken) {
      return res
        .status(403)
        .json({ success: false, message: 'Invalid refresh token' });
    }

    const newToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    user.refreshToken = newRefreshToken;
    await user.save();

    res
      .status(200)
      .json({ success: true, token: newToken, refreshToken: newRefreshToken });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      res
        .status(403)
        .json({ success: false, message: 'Refresh token expired' });
    } else {
      res
        .status(500)
        .json({ success: false, message: 'Internal server error' });
    }
  }
};
