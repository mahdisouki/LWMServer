const crypto = require('crypto');
const { User } = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Driver = require('../models/Driver');
const Helper = require('../models/Helper');
const Truck = require('../models/Truck');
const { sendPasswordResetEmail } = require('../utils/sendPasswordResetEmail');
require('dotenv').config();

const GENERIC_FORGOT_PASSWORD_MESSAGE =
  'If an account exists for this email, a password reset link has been sent.';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getResetExpiresAt() {
  const minutes = Number(process.env.PASSWORD_RESET_EXPIRES_MINUTES || 60);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
  return new Date(Date.now() + safeMinutes * 60 * 1000);
}

function getPasswordResetFrontendUrl(audience) {
  const base = audience === 'driver'
    ? (process.env.DRIVER_APP_URL || process.env.CLIENT_URL || 'http://localhost:5173')
    : (process.env.BO_FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:5173');
  return String(base).replace(/\/$/, '');
}

async function findUserForPasswordReset(email, audience) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return null;
  }

  if (audience === 'driver') {
    return User.findOne({
      email: normalized,
      role: { $in: ['Driver', 'Helper'] },
    });
  }

  return User.findOne({ email: normalized, role: 'Admin' });
}

const generateAccessToken = (user) => {
  return jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

const generateRefreshToken = (user) => {
  return jwt.sign({ userId: user._id }, process.env.REFRESH_SECRET, { expiresIn: "7d" });
};

exports.userSignIn = async (req, res) => {
  console.log("Signing in user...");
  const { email, password } = req.body;

  try {
    
    const user = await User.findOne({ email , role: 'Admin' });
    
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
        phoneNumber: Array.isArray(user.phoneNumber) ? user.phoneNumber[0] : user.phoneNumber, 
        truckId : truck ? truck._id : null,
        picture: user.picture || null,
        permissions: user.permissions || null,
      },
      token,
      refreshToken,
    });
  } catch (error) {
    console.error("Error while signing in:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.driverSignIn = async (req, res) => {
  console.log("Signing in driver...");
  const { email, password } = req.body;

  try {
    const driver = await User.findOne({ email , role: 'Driver' }) || await User.findOne({ email , role: 'Helper' });
    if (!driver) {
      console.log("Driver not found with the given email!");
      return res.status(404).json({ success: false, message: "Driver not found with the given email!" });
    }
    
    const isMatch = await bcrypt.compare(password, driver.password);
    if (!isMatch) {
      console.log("Password is incorrect!");
      return res.status(401).json({ success: false, message: "Password is incorrect!" });
    }

    console.log("Password matched, generating tokens.");
    
    const token = generateAccessToken(driver);
    const refreshToken = generateRefreshToken(driver);
    driver.refreshToken = refreshToken;
    await driver.save();

    let startTime = null;
    let truck = null;

    if (driver.role[0] === 'Driver') {
      console.log("User is a driver");
      const driverDoc = await Driver.findById(driver._id);
      //check if driver start time have passed 9
      startTime = driverDoc ? driverDoc.startTime : null;
      
      truck = await Truck.findOne({ driverId: driver._id }).populate('tasks');
    } else if (driver.role[0] === 'Helper') {
      console.log("User is a helper");
      const helper = await Helper.findById(driver._id);
      startTime = helper ? helper.startTime : null;
    
      truck = await Truck.findOne({ helperId: driver._id }).populate('tasks');
    }

    console.log("Driver signed in successfully", driver);

    res.json({
      success: true,
      user: { 
        ...driver._doc,
        id: driver._id,
        startTime,
        phoneNumber: Array.isArray(driver.phoneNumber) ? driver.phoneNumber[0] : driver.phoneNumber, 
        truckId : truck ? truck._id : null,
        picture: driver.picture || null,
        permissions: driver.permissions || null,
      },
      token,
      refreshToken,
    });
  } catch (error) {
    console.error("Error while signing in driver:", error);
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

exports.logout = async (req, res) => {
  try {
    const user = req.user; // User from isAuth middleware
    
    if (!user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // Invalidate refresh token by clearing it
    user.refreshToken = undefined;
    await user.save();

    console.log(`User ${user._id} logged out successfully`);

    res.status(200).json({ 
      success: true, 
      message: "Logged out successfully" 
    });
  } catch (error) {
    console.error("Error during logout:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email, audience = 'admin' } = req.body;
    const normalized = normalizeEmail(email);

    if (!normalized) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const resolvedAudience = audience === 'driver' ? 'driver' : 'admin';
    const user = await findUserForPasswordReset(normalized, resolvedAudience);

    if (user) {
      const rawToken = generateResetToken();
      user.passwordResetToken = hashResetToken(rawToken);
      user.passwordResetExpires = getResetExpiresAt();
      user.refreshToken = undefined;
      await user.save();

      const resetUrl = `${getPasswordResetFrontendUrl(resolvedAudience)}/reset-password?token=${rawToken}`;
      await sendPasswordResetEmail({
        to: user.email,
        resetUrl,
        firstName: user.firstName || user.username,
      });
    }

    res.status(200).json({
      success: true,
      message: GENERIC_FORGOT_PASSWORD_MESSAGE,
    });
  } catch (error) {
    console.error('Error during forgot password:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;

    if (!token || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token, newPassword, and confirmPassword are required',
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match' });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters',
      });
    }

    const user = await User.findOne({
      passwordResetToken: hashResetToken(token),
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset link. Please request a new one.',
      });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.refreshToken = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password updated successfully. You can sign in with your new password.',
    });
  } catch (error) {
    console.error('Error during reset password:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
