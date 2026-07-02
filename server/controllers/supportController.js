// controllers/supportController.js
const axios = require("axios");
const User = require("../models/userModel");

/**
 * POST /api/support/message
 * Sends user message along with user context to n8n AI Agent.
 */
const sendMessage = async (req, res) => {
    const { message, userLocation } = req.body;

    if (!message) {
        return res.status(400).json({ success: false, message: "Message is required" });
    }

    try {
        const { phone, role } = req.user;

        // Fetch detailed user profile from database (gracefully fallback if DB is offline)
        let userProfile = null;
        try {
            userProfile = await User.findOne({ phone, role }).lean().maxTimeMS(2000);
        } catch (dbErr) {
            console.warn(`[Support API] DB profile fetch failed (using session defaults). Error: ${dbErr.message}`);
        }

        // Normalize coordinates safely
        let normalizedLocation = null;
        if (userLocation) {
            const rawLat = userLocation.latitude !== undefined ? userLocation.latitude : userLocation.lat;
            const rawLng = userLocation.longitude !== undefined ? userLocation.longitude : userLocation.lng;
            if (rawLat !== undefined && rawLng !== undefined) {
                const latNum = parseFloat(rawLat);
                const lngNum = parseFloat(rawLng);
                if (!isNaN(latNum) && !isNaN(lngNum)) {
                    normalizedLocation = { lat: latNum, lng: lngNum };
                }
            }
        }

        // Construct payload context for n8n (extremely light)
        const n8nPayload = {
            message,
            sessionId: phone,
            userContext: {
                name: userProfile?.name || "GetGo User",
                phone: userProfile?.phone || phone,
                role: userProfile?.role || role,
                email: userProfile?.email || "",
                age: userProfile?.age || null,
                gender: userProfile?.gender || ""
            },
            transitContext: {
                userReportedLocation: normalizedLocation,
                systemTime: new Date().toISOString()
            }
        };

        console.log(`[Support API] Forwarding query to n8n webhook for user ${phone} (${role})`);

        const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || "http://localhost:5678/webhook/customer-support";

        // Forward request to n8n AI Agent Webhook
        const response = await axios.post(n8nWebhookUrl, n8nPayload, {
            headers: {
                "Content-Type": "application/json"
            },
            timeout: 20000 // 20 seconds timeout for agent reasoning
        });

        let botResponseText = "";
        let n8nData = response.data;

        if (Array.isArray(n8nData)) {
            n8nData = n8nData[0];
        }

        if (n8nData) {
            botResponseText = n8nData.output || n8nData.response || n8nData.message || n8nData.text || (typeof n8nData === 'string' ? n8nData : JSON.stringify(n8nData));
        }

        if (!botResponseText) {
            botResponseText = "AI agent received the message, but did not return a response body. Please ensure your n8n workflow finishes and returns a valid output response.";
        }

        res.status(200).json({
            success: true,
            response: botResponseText
        });

    } catch (error) {
        console.error("Support controller error:", error.message);
        
        // Return a cleaner message to the user but log detailed error
        let errorMsg = "Could not connect to the n8n AI Customer Support agent.";
        if (error.code === "ECONNREFUSED") {
            errorMsg = "n8n server is offline at the configured webhook URL.";
        } else if (error.code === "ETIMEDOUT" || error.message.includes("timeout")) {
            errorMsg = "Request to the AI agent timed out. Please try again.";
        }

        res.status(500).json({
            success: false,
            message: errorMsg,
            error: error.message
        });
    }
};

module.exports = {
    sendMessage
};
