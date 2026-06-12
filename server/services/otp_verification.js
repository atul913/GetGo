// otp_verification_service.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;

const baseURL = "https://cpaas.messagecentral.com/";
const customerId = process.env.MC_CUSTOMER_ID;
const email = process.env.MC_EMAIL;
const password = process.env.MC_PASSWORD;

let authToken = null;
let tokenExpiry = 0;

// Per-phone-number verification IDs (in-memory; use Redis/DB in production)
const verificationStore = new Map();

const generateAuthToken = async () => {
    // Cache token for ~24h to avoid hitting the auth endpoint every time
    if (authToken && Date.now() < tokenExpiry) {
        return authToken;
    }

    const base64String = Buffer.from(password).toString("base64");

    const url = `${baseURL}/auth/v1/authentication/token?country=IN&customerId=${customerId}&email=${encodeURIComponent(email)}&key=${base64String}&scope=NEW`;

    const response = await axios.get(url, {
        headers: { accept: "*/*" },
    });

    authToken = response.data.token;
    tokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // refresh slightly before 24h
    return authToken;
};

const sendOtp = async (countryCode, mobileNumber) => {
    const token = await generateAuthToken();

    const url = `${baseURL}/verification/v3/send?countryCode=${countryCode}&customerId=${customerId}&flowType=SMS&mobileNumber=${mobileNumber}&otpLength=4`;

    const response = await axios.post(url, {}, {
        headers: {
            accept: "*/*",
            authToken: token,
        },
    });

    const verificationId = response.data?.data?.verificationId;

    if (!verificationId) {
        throw new Error(response.data?.data?.errorMessage || "Failed to send OTP");
    }

    verificationStore.set(`${countryCode}-${mobileNumber}`, verificationId);

    return response.data;
};

const validateOtp = async (otpCode, countryCode, mobileNumber) => {
    const token = await generateAuthToken();
    const verificationId = verificationStore.get(`${countryCode}-${mobileNumber}`);

    if (!verificationId) {
        throw new Error("No OTP request found for this number. Send OTP first.");
    }

    const url = `${baseURL}/verification/v3/validateOtp?countryCode=${countryCode}&mobileNumber=${mobileNumber}&verificationId=${verificationId}&customerId=${customerId}&code=${otpCode}`;

    const response = await axios.get(url, {
        headers: {
            accept: "*/*",
            authToken: token,
        },
    });

    return response.data;
};

app.post("/sendotp/:countryCode/:mobileNumber", async (req, res) => {
    const { countryCode, mobileNumber } = req.params;

    try {
        const body = await sendOtp(countryCode, mobileNumber);

        if (body.data.responseCode === 200 && !body.data.errorMessage) {
            res.status(200).json({ success: true, message: "OTP sent successfully" });
        } else {
            res.status(400).json({ success: false, message: body.data.errorMessage });
        }
    } catch (error) {
        console.error("Error sending OTP:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get("/validateOtp/:countryCode/:mobileNumber/:otpCode", async (req, res) => {
    const { countryCode, mobileNumber, otpCode } = req.params;

    try {
        const body = await validateOtp(otpCode, countryCode, mobileNumber);

        if (body.data.verificationStatus === "VERIFICATION_COMPLETED" && !body.data.errorMessage) {
            // Clean up so the same verificationId can't be reused
            verificationStore.delete(`${countryCode}-${mobileNumber}`);
            res.status(200).json({ success: true, message: "OTP verified" });
        } else {
            res.status(400).json({ success: false, message: body.data.errorMessage || "Invalid OTP" });
        }
    } catch (error) {
        console.error("Error verifying OTP:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(port, () => {
    console.log(`OTP server running at http://localhost:${port}`);
});