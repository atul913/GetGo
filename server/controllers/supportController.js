// controllers/supportController.js
const User = require("../models/userModel");
const ChatHistory = require("../models/chatHistoryModel");
const aiService = require("../services/aiService");
const busService = require("../services/busService");

/**
 * Helper: Get human-readable IST timestamp and time-of-day context.
 */
const getISTContext = () => {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const ist = new Date(now.getTime() + istOffset);

    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const dayName = days[ist.getUTCDay()];
    const date = ist.getUTCDate();
    const month = months[ist.getUTCMonth()];
    const year = ist.getUTCFullYear();
    let hours = ist.getUTCHours();
    const minutes = ist.getUTCMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;

    const timeStr = `${dayName}, ${date} ${month} ${year}, ${hours}:${minutes} ${ampm} IST`;

    const hour24 = ist.getUTCHours();
    let period = "night";
    if (hour24 >= 5 && hour24 < 12) period = "morning";
    else if (hour24 >= 12 && hour24 < 17) period = "afternoon";
    else if (hour24 >= 17 && hour24 < 21) period = "evening";

    return { timeStr, period };
};

/**
 * Helper: Get active trip info for a driver from Redis.
 */
const getDriverTripContext = async (phone) => {
    try {
        const activeBuses = await busService.getActiveBuses();
        const driverBus = activeBuses.find(b => b.driverPhone === phone);
        if (driverBus) {
            return {
                isActive: true,
                busId: driverBus.busId,
                routeId: driverBus.routeId,
                routeName: driverBus.routeName,
                lat: driverBus.lat,
                lng: driverBus.lng,
                startedAt: driverBus.startedAt
            };
        }
    } catch (err) {
        console.warn("[Support API] Failed to fetch driver trip context:", err.message);
    }
    return { isActive: false };
};

/**
 * Build the system prompt with full user context.
 */
const buildSystemPrompt = (userProfile, phone, role, normalizedLocation, tripContext) => {
    const { timeStr, period } = getISTContext();
    const userName = userProfile?.name || "there";
    const userAge = userProfile?.age || "Not specified";
    const userGender = userProfile?.gender || "Not specified";

    let tripBlock = "";
    if (role === "driver" && tripContext) {
        if (tripContext.isActive) {
            tripBlock = `
Driver's Active Trip:
- Status: BROADCASTING LIVE
- Bus ID: ${tripContext.busId}
- Route: ${tripContext.routeName || "Unknown"} (ID: ${tripContext.routeId || "N/A"})
- Current GPS: ${tripContext.lat}, ${tripContext.lng}
- Started at: ${new Date(tripContext.startedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;
        } else {
            tripBlock = `
Driver's Active Trip:
- Status: NO ACTIVE TRIP (driver is currently offline / not broadcasting)`;
        }
    }

    return `You are GoBuddy, the GetGo transit support assistant for Indore, India. You are concise, precise, and direct.

User Profile:
- Name: ${userName}
- Phone: ${phone}
- Role: ${role === "commuter" ? "Commuter" : "Driver"}
- Age: ${userAge}
- Gender: ${userGender}

Context:
- Current Time: ${timeStr} (${period})
- User's GPS Location: ${normalizedLocation ? `${normalizedLocation.lat}, ${normalizedLocation.lng}` : "22.7196, 75.8577 (Central Indore default)"}
${tripBlock}

Indore transit route types:
- M-xx (Metro/Main Routes)
- R-xx (Ring Road Routes)
- C-xx (City Core Routes)
- N-xx (Night Routes)

Available tools:
1. \`getNearestStops\`: Finds nearest stops to a lat/lng.
2. \`searchStops\`: Finds stops matching text or landmark queries.
3. \`getRouteStops\`: Lists stops for a route ID.
4. \`planRoute\`: Connects two stops (by name or coordinates) and resolves routes.
5. \`getLiveBuses\`: Gets real-time active buses and their arrival window.

CORE DIRECTIVES:
1. NO EMOJIS: Never output any emojis under any circumstances.
2. ONE-LINER GREETINGS: When the user says hi/hello or a basic greeting, reply with a single concise sentence (e.g. "Hello ${userName}, how can I help you navigate Indore transit today?").
3. ONE-LINER INSTRUCTIONS: Any instructional or informational advice must be a crisp one-liner.
4. AUTOMATED DESTINATION NAVIGATION (CRITICAL):
   - When a user asks how to get to any place, landmark, shop, or area in Indore (e.g. "how can i go to madhuram sandwich, bhawarkuan", "how to reach Vijay Nagar", etc.):
   - DO NOT ASK the user for their starting location or any other details.
   - Immediately use the User's GPS Location from context as the starting point (e.g., call \`getNearestStops\` or \`planRoute\` with start coordinates).
   - Search the destination (e.g., "bhawarkuan") to resolve the destination stop.
   - Identify the bus route connecting the nearest start stop to the destination stop.
   - Check \`getLiveBuses\` for active buses on that route.
   - In your final response:
     - Name the nearest start stop to board and the destination stop.
     - Name the route to take.
     - State the arrival time of the next bus.
     - If no active buses are currently tracked on that route within the next 20 minutes, explicitly state: "No active buses are currently tracked on this route in the next 20 minutes."
5. NO DATABASE KEYS OR OBJECTIDS: Never display raw MongoDB ObjectIDs. Use bold stop and route names only.
6. NO BULLET POINTS OR NUMBERED LISTS: Keep paragraphs short (1-2 sentences maximum).
7. DRIVER QUERIES: If a driver asks about their active trip or route, use the Driver's Active Trip context above directly.
8. ACCURACY: If no route connects the stops, state that no direct route was found and suggest the closest major transit hub.`;
};

/**
 * POST /api/support/message
 * Sends user message along with user context to the Groq AI agent, executing tools locally.
 */
const sendMessage = async (req, res) => {
    const { message, userLocation, activeView, tripStatus } = req.body;

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

        // Get driver trip context if applicable
        let tripContext = null;
        if (role === "driver") {
            tripContext = await getDriverTripContext(phone);
        }

        // Session key includes role to prevent commuter/driver history collision
        const sessionKey = `${phone}_${role}`;

        // Retrieve or initialize persistent support chat history from database
        let chatHistoryDoc = null;
        try {
            chatHistoryDoc = await ChatHistory.findOne({ sessionId: sessionKey });
        } catch (dbErr) {
            console.warn(`[Support API] Support chat history fetch failed. Error: ${dbErr.message}`);
        }

        if (!chatHistoryDoc) {
            chatHistoryDoc = new ChatHistory({ sessionId: sessionKey, messages: [] });
        }

        // Prune message history to keep it under 20 messages (prevents context window bloating)
        if (chatHistoryDoc.messages && chatHistoryDoc.messages.length > 20) {
            chatHistoryDoc.messages = chatHistoryDoc.messages.slice(-20);
        }

        // Build enriched system prompt
        const systemPrompt = buildSystemPrompt(userProfile, phone, role, normalizedLocation, tripContext);

        const systemMessage = {
            role: "system",
            content: systemPrompt
        };

        // Map stored chat_histories messages to Groq API compatible messages
        const mappedHistory = (chatHistoryDoc.messages || []).map(msg => ({
            role: msg.type === "human" ? "user" : "assistant",
            content: msg.data?.content || ""
        }));

        // Construct messages array to send to Groq API
        const apiMessages = [
            systemMessage,
            ...mappedHistory,
            { role: "user", content: message }
        ];

        console.log(`[Support API] Forwarding query to Groq agent for user ${phone} (${role})`);

        let responseText = "";
        try {
            // Execute AI response loop with local tool calling
            const chatResponse = await aiService.getChatResponse(apiMessages);
            responseText = chatResponse.text;
            // Clean any residual emojis
            responseText = responseText.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu, '').trim();
        } catch (aiError) {
            console.warn("[Support API] AI Service unavailable, generating fallback response:", aiError.message);
            responseText = generateFallbackResponse(message, userProfile, role, normalizedLocation);
        }

        // Update database chat history in human/ai format
        chatHistoryDoc.messages.push({
            type: "human",
            data: { content: message }
        });
        chatHistoryDoc.messages.push({
            type: "ai",
            data: { content: responseText }
        });

        try {
            await chatHistoryDoc.save();
        } catch (dbSaveErr) {
            console.warn(`[Support API] Support chat history save failed. Error: ${dbSaveErr.message}`);
        }

        res.status(200).json({
            success: true,
            response: responseText
        });

    } catch (error) {
        console.error("Support controller error:", error.message);

        res.status(200).json({
            success: true,
            response: "I am having a brief technical delay. Please check your dashboard map for live bus routes."
        });
    }
};

/**
 * DELETE /api/support/history
 * Clears the chat history for the authenticated user.
 */
const clearHistory = async (req, res) => {
    try {
        const { phone, role } = req.user;
        const sessionKey = `${phone}_${role}`;

        await ChatHistory.deleteOne({ sessionId: sessionKey });

        res.status(200).json({ success: true, message: "Chat history cleared" });
    } catch (error) {
        console.error("clearHistory error:", error.message);
        res.status(500).json({ success: false, message: "Failed to clear chat history" });
    }
};

/**
 * Generate clean, one-liner, emoji-free fallback responses when AI is unavailable.
 */
const generateFallbackResponse = (message, userProfile, role, location) => {
    const name = userProfile?.name || "there";
    const lowerMsg = message.toLowerCase();

    if (lowerMsg.includes("hello") || lowerMsg.includes("hi") || lowerMsg.includes("hey")) {
        return `Hello ${name}, how can I help you navigate Indore transit today?`;
    }

    if (lowerMsg.includes("stop") || lowerMsg.includes("near")) {
        if (location) {
            return `Nearest stops around your location are available on your live dashboard map.`;
        }
        return "Please enable GPS location to view bus stops near your current location.";
    }

    if (lowerMsg.includes("route") || lowerMsg.includes("bus")) {
        return "Major active corridors include Palasia, Vijay Nagar, Geeta Bhawan, and Rajwada.";
    }

    if (lowerMsg.includes("sos") || lowerMsg.includes("emergency") || lowerMsg.includes("police")) {
        return "For emergency assistance, dial 112 or use the SOS panel in the sidebar.";
    }

    if (role === "driver" && (lowerMsg.includes("trip") || lowerMsg.includes("broadcast"))) {
        return "To broadcast your location, tap Start Trip on your driver dashboard.";
    }

    return "Live bus positions and stops can be viewed directly on your interactive map.";
};

module.exports = {
    sendMessage,
    clearHistory
};
