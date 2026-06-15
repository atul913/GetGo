// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

const { requireAuth } = require("../middleware/authMiddleware");
const multer = require("multer");

const upload = multer({
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

router.post("/send-otp", authController.sendOtp);
router.post("/verify-otp", authController.verifyOtp);

// Profile Management Routes
router.get("/profile", requireAuth, authController.getProfile);
router.put("/profile", requireAuth, authController.updateProfile);
router.post("/profile/image", requireAuth, upload.single("image"), authController.uploadProfileImage);

module.exports = router;