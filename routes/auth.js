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
    refresh,
  } = require("../controllers/authCtrl");
const { verifyRefreshToken } = require("../middlewares/auth");


router.post("/sign-in" , userSignIn);
router.post("/refresh" ,verifyRefreshToken, refresh);

module.exports = router;