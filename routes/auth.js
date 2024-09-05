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