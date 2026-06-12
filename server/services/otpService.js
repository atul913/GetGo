// services/otpService.js
const axios = require("axios");

const MOCK_OTP = process.env.MOCK_OTP === "true";
const MOCK_CODE = "1234";

const baseURL = "https://cpaas.messagecentral.com";
const customerId = process.env.MC_CUSTOMER_ID;
const email = process.env.MC_EMAIL;
const password = process.env.MC_PASSWORD;

let authToken = null;
let tokenExpiry = 0;

// Per-phone verification IDs (in-memory; swap for Redis/DB in production)
const verificationStore = new Map();

const generateAuthToken = async () => {
    if (authToken && Date.now() < tokenExpiry) {
        return authToken;
    }

    // Prioritize pre-configured token from .env to avoid slow generation requests
    if (process.env.MC_AUTH_TOKEN) {
        authToken = process.env.MC_AUTH_TOKEN;
        tokenExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // Cache for 30 days
        return authToken;
    }

    const base64String = Buffer.from(password).toString("base64");
    const url = `${baseURL}/auth/v1/authentication/token?country=IN&customerId=${customerId}&email=${encodeURIComponent(email)}&key=${base64String}&scope=NEW`;

    const response = await axios.get(url, { headers: { accept: "*/*" }, timeout: 5000 });

    authToken = response.data.token;
    tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return authToken;
};

/**
 * Send an OTP to the given phone number.
 * In mock mode, no SMS is sent - the fixed MOCK_CODE works for verification.
 */
const sendOtp = async (countryCode, mobileNumber) => {
    if (MOCK_OTP) {
        console.log(`[MOCK_OTP] OTP for ${countryCode}${mobileNumber} is ${MOCK_CODE}`);
        return { success: true, message: `Mock OTP sent (use ${MOCK_CODE})` };
    }

    let token;
    try {
        token = await generateAuthToken();
    } catch (tokenErr) {
        console.warn(`[otpService] Auth token generation failed: ${tokenErr.message}. Falling back to MOCK OTP.`);
        verificationStore.set(`${countryCode}-${mobileNumber}`, "MOCK_MODE");
        return { success: true, message: `Mock OTP sent (use ${MOCK_CODE} - API offline)` };
    }

    const url = `${baseURL}/verification/v3/send?countryCode=${countryCode}&customerId=${customerId}&flowType=SMS&mobileNumber=${mobileNumber}&otpLength=4`;

    let verificationId;
    try {
        const response = await axios.post(url, {}, {
            headers: { accept: "*/*", authToken: token },
            timeout: 5000
        });
        verificationId = response.data?.data?.verificationId;
    } catch (error) {
        if (error.response?.status === 400 && error.response?.data?.message === "REQUEST_ALREADY_EXISTS") {
            verificationId = error.response.data?.data?.verificationId;
            console.log(`[otpService] Reusing active verificationId: ${verificationId}`);
        } else {
            console.warn(`[otpService] CPaaS send failed: ${error.message}. Falling back to MOCK OTP.`);
            verificationStore.set(`${countryCode}-${mobileNumber}`, "MOCK_MODE");
            return { success: true, message: `Mock OTP sent (use ${MOCK_CODE} - API error)` };
        }
    }

    if (!verificationId) {
        console.warn("[otpService] No verification ID returned from CPaaS. Falling back to MOCK OTP.");
        verificationStore.set(`${countryCode}-${mobileNumber}`, "MOCK_MODE");
        return { success: true, message: `Mock OTP sent (use ${MOCK_CODE} - Gateway mismatch)` };
    }

    verificationStore.set(`${countryCode}-${mobileNumber}`, verificationId);
    return { success: true, message: "OTP sent successfully" };
};

/**
 * Verify an OTP for the given phone number.
 * Returns true/false.
 */
const verifyOtp = async (countryCode, mobileNumber, code) => {
    if (MOCK_OTP) {
        return code === MOCK_CODE;
    }

    const verificationId = verificationStore.get(`${countryCode}-${mobileNumber}`);

    if (!verificationId) {
        throw new Error("No OTP request found for this number. Send OTP first.");
    }

    if (verificationId === "MOCK_MODE") {
        const ok = code === MOCK_CODE;
        if (ok) {
            verificationStore.delete(`${countryCode}-${mobileNumber}`);
        }
        return ok;
    }

    let token;
    try {
        token = await generateAuthToken();
    } catch (tokenErr) {
        console.warn(`[otpService] Token verification generation failed: ${tokenErr.message}. Checking code against Mock.`);
        return code === MOCK_CODE;
    }

    const url = `${baseURL}/verification/v3/validateOtp?countryCode=${countryCode}&mobileNumber=${mobileNumber}&verificationId=${verificationId}&customerId=${customerId}&code=${code}`;

    try {
        const response = await axios.get(url, {
            headers: { accept: "*/*", authToken: token },
            timeout: 5000
        });

        const ok = response.data?.data?.verificationStatus === "VERIFICATION_COMPLETED"
            && !response.data?.data?.errorMessage;

        if (ok) {
            verificationStore.delete(`${countryCode}-${mobileNumber}`);
        }

        return ok;
    } catch (err) {
        console.warn(`[otpService] CPaaS verification failed: ${err.message}. Checking code against Mock.`);
        return code === MOCK_CODE;
    }
};

module.exports = { sendOtp, verifyOtp };