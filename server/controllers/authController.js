// controllers/authController.js
const otpService = require("../services/otpService");
const tokenService = require("../services/tokenService");
const User = require("../models/userModel");
const cloudinaryService = require("../services/cloudinaryService");
const fs = require("fs");
const path = require("path");

/**
 * POST /api/auth/send-otp
 * body: { countryCode, phone }
 */
const sendOtp = async (req, res) => {
    const { countryCode = "91" } = req.body;
    const phone = req.body.phone || req.body.mobileNumber;

    if (!phone) {
        return res.status(400).json({ success: false, message: "Phone number is required" });
    }

    // Clean up mobile number (remove spaces/dashes)
    const cleanPhone = phone.toString().replace(/[\s-+]/g, "");

    try {
        const result = await otpService.sendOtp(countryCode, cleanPhone);
        res.status(200).json(result);
    } catch (error) {
        console.error("sendOtp error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * POST /api/auth/verify-otp
 * body: { countryCode, phone, otp, role: "driver" | "commuter" }
 */
const verifyOtp = async (req, res) => {
    const { countryCode = "91", role } = req.body;
    const phone = req.body.phone || req.body.mobileNumber;
    const otp = req.body.otp || req.body.otpCode;

    if (!phone || !otp || !role) {
        return res.status(400).json({ success: false, message: "phone, otp and role are required" });
    }

    const cleanPhone = phone.toString().replace(/[\s-+]/g, "");
    const cleanRole = role.toLowerCase().trim();

    if (!["driver", "commuter"].includes(cleanRole)) {
        return res.status(400).json({ success: false, message: "role must be 'driver' or 'commuter'" });
    }

    try {
        const isValid = await otpService.verifyOtp(countryCode, cleanPhone, otp);

        if (!isValid) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        const token = tokenService.createToken(cleanPhone, cleanRole);

        // Fetch or create user in MongoDB statelessly
        let userProfile = { role: cleanRole, phone: cleanPhone };
        try {
            let dbUser = await User.findOne({ phone: cleanPhone, role: cleanRole });
            if (!dbUser) {
                dbUser = new User({ phone: cleanPhone, role: cleanRole });
                await dbUser.save();
                console.log(`[MongoDB] Created new user profile: ${cleanPhone} (${cleanRole})`);
            }
            userProfile = dbUser;
        } catch (dbErr) {
            console.error("[MongoDB] Error ensuring user profile in verifyOtp:", dbErr.message);
        }

        res.status(200).json({
            success: true,
            token,
            role: cleanRole,
            phone: cleanPhone,
            user: userProfile
        });
    } catch (error) {
        console.error("verifyOtp error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/auth/profile
 * Requires authentication
 */
const getProfile = async (req, res) => {
    try {
        const { phone, role } = req.user;
        let userProfile = await User.findOne({ phone, role });

        if (!userProfile) {
            userProfile = new User({ phone, role });
            await userProfile.save();
        }

        res.status(200).json({ success: true, user: userProfile });
    } catch (error) {
        console.error("getProfile error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * PUT /api/auth/profile
 * Requires authentication
 */
const updateProfile = async (req, res) => {
    try {
        const { phone, role } = req.user;
        const { name, email, age, gender } = req.body;

        const updatedUser = await User.findOneAndUpdate(
            { phone, role },
            {
                $set: {
                    name: name !== undefined ? name : "",
                    email: email !== undefined ? email : "",
                    age: age !== undefined && age !== "" ? Number(age) : null,
                    gender: gender !== undefined ? gender : ""
                }
            },
            { new: true, runValidators: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: "User profile not found" });
        }

        res.status(200).json({ success: true, user: updatedUser });
    } catch (error) {
        console.error("updateProfile error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * POST /api/auth/profile/image
 * Requires authentication
 */
const uploadProfileImage = async (req, res) => {
    try {
        const { phone, role } = req.user;

        if (!req.file) {
            return res.status(400).json({ success: false, message: "Image file is required" });
        }

        let imageUrl;
        try {
            // Upload buffer to Cloudinary
            imageUrl = await cloudinaryService.uploadBuffer(req.file.buffer);
        } catch (cloudinaryError) {
            console.warn("[Cloudinary] Upload failed, falling back to local storage:", cloudinaryError.message);

            // local uploads directory path inside static client folder
            const uploadsDir = path.join(__dirname, "..", "..", "client", "uploads", "profile_images");

            // Ensure directory exists
            if (!fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
            }

            // Clean up mobile number (remove spaces/dashes/plus)
            const cleanPhone = phone.toString().replace(/[\s-+]/g, "");

            const fileExt = req.file.mimetype === "image/png" ? "png" : "jpg";
            const filename = `${role.toLowerCase()}_${cleanPhone}.${fileExt}`;
            const filePath = path.join(uploadsDir, filename);

            // Save buffer locally
            fs.writeFileSync(filePath, req.file.buffer);

            // Relative URL for browser to load from static express serving
            imageUrl = `/uploads/profile_images/${filename}`;
        }

        // Update user profile image URL in MongoDB
        const updatedUser = await User.findOneAndUpdate(
            { phone, role },
            { $set: { profileImageUrl: imageUrl } },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: "User profile not found" });
        }

        res.status(200).json({ success: true, profileImageUrl: imageUrl, user: updatedUser });
    } catch (error) {
        console.error("uploadProfileImage error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { sendOtp, verifyOtp, getProfile, updateProfile, uploadProfileImage };