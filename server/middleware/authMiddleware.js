// middleware/authMiddleware.js
const tokenService = require("../services/tokenService");

/**
 * Reads "Authorization: Bearer <token>" header, validates it,
 * and attaches req.user = { phone, role } if valid.
 */
const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
        return res.status(401).json({ success: false, message: "Missing or invalid Authorization header" });
    }

    const session = tokenService.getSession(token);
    if (!session) {
        return res.status(401).json({ success: false, message: "Invalid or expired session" });
    }

    req.user = session;
    next();
};

/**
 * Restrict access to a specific role ("driver" or "commuter").
 * Use after requireAuth.
 */
const requireRole = (role) => (req, res, next) => {
    if (req.user?.role !== role) {
        return res.status(403).json({ success: false, message: `Requires ${role} role` });
    }
    next();
};

module.exports = { requireAuth, requireRole };