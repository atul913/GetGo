// services/tokenService.js
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "getgo_development_jwt_secret_key_987654321";

/**
 * Creates a stateless JWT for the user.
 * Expiration times:
 * - commuter: 7 days (7d)
 * - driver: 30 days (30d)
 */
const createToken = (phone, role) => {
    const cleanRole = role.toLowerCase().trim();
    const expiresIn = cleanRole === "driver" ? "30d" : "7d";
    
    return jwt.sign({ phone, role: cleanRole }, JWT_SECRET, { expiresIn });
};

/**
 * Verifies a token and returns the decoded payload { phone, role }.
 * Returns null if token is expired, invalid, or missing.
 */
const getSession = (token) => {
    try {
        if (!token) return null;
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
};

/**
 * Stateless JWT logout is handled client-side by clearing localStorage,
 * so destroyToken is a no-op.
 */
const destroyToken = (token) => {
    // No-op for stateless JWTs
};

module.exports = { createToken, getSession, destroyToken };