// middleware/supportAuth.js
module.exports = (req, res, next) => {
    const apiKey = req.headers["x-api-key"] || req.headers["x-api-token"];
    const expectedKey = process.env.SUPPORT_API_KEY || "getgo_n8n_secret_key";

    if (!apiKey || apiKey !== expectedKey) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized: Invalid or missing API key header (x-api-key)"
        });
    }

    next();
};
