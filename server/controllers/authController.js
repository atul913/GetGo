// controllers/authController.js
const otpService = require("../services/otpService");
const tokenService = require("../services/tokenService");

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
        res.status(200).json({
            success: true,
            token,
            role: cleanRole,
            phone: cleanPhone,
            user: {
                role: cleanRole,
                phone: cleanPhone
            }
        });
    } catch (error) {
        console.error("verifyOtp error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { sendOtp, verifyOtp };