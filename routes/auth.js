/**
 * @swagger
 * /api/sign-in:
 *   post:
 *     summary: User sign-in
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 description: User's email
 *               password:
 *                 type: string
 *                 description: User's password
 *     responses:
 *       200:
 *         description: Successful sign-in
 *       401:
 *         description: Unauthorized
 */

const express = require("express");
const router = express.Router();
const {
    userSignIn,
    driverSignIn,
    brokerSignIn,
    refresh,
    logout,
    forgotPassword,
    resetPassword,
  } = require("../controllers/authCtrl");
const { verifyRefreshToken, isAuth } = require("../middlewares/auth");
const { loginLimiter } = require("../middlewares/rateLimiter");


router.post("/sign-in" , loginLimiter, userSignIn);
router.post("/driver-sign-in" , loginLimiter, driverSignIn);
router.post("/broker-sign-in" , loginLimiter, brokerSignIn);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/refresh" ,verifyRefreshToken, refresh);
router.post("/logout" , isAuth, logout);

module.exports = router;