// services/tokenService.js
const crypto = require("crypto");

// In-memory session store: token -> { phone, role }
// Tokens persist until the server restarts. Swap for a DB/Redis for production.
const sessions = new Map();

const createToken = (phone, role) => {
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, { phone, role, createdAt: Date.now() });
    return token;
};

const getSession = (token) => {
    return sessions.get(token) || null;
};

const destroyToken = (token) => {
    sessions.delete(token);
};

module.exports = { createToken, getSession, destroyToken };