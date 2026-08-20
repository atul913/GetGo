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

    return `You are GoBuddy, the GetGo transit support assistant. You are warm, friendly, concise, and always helpful — like a knowledgeable local friend who knows Indore's bus system inside-out.

User Profile:
- Name: ${userName}
- Phone: ${phone}
- Role: ${role === "commuter" ? "Commuter (Passenger)" : "Bus Driver"}
- Age: ${userAge}
- Gender: ${userGender}

Current Context:
- Time: ${timeStr}
- It's ${period} in Indore right now.
- User's GPS: ${normalizedLocation ? `${normalizedLocation.lat}, ${normalizedLocation.lng}` : "Not available"}
${tripBlock}

Indore transit routes follow these prefixes:
- **M-xx** (Metro/Main Routes)
- **R-xx** (Ring Road Routes)
- **C-xx** (City Core Routes)
- **N-xx** (Night Routes)

Available tools:
1. \`getNearestStops\` — Find nearest transit stops by lat/lng coordinates.
2. \`searchStops\` — Search stops by name (handles Palasia/Palasiya, Bhawan/Bhavan variants).
3. \`getRouteStops\` — Get all stops in order for a route ID.
4. \`planRoute\` — Find routes connecting two stops by name or coordinates.
5. \`getLiveBuses\` — Get live GPS locations of active buses, optionally filtered by route or stop.

STRICT RULES:
1. **Be human**: Greet by name. Be warm and brief. No robotic language. Use "you" and "I" naturally.
2. **Be brief**: 2-3 short paragraphs max. Users are on mobile, on the go. Every word must earn its place.
3. **No IDs**: Never show MongoDB ObjectIDs or raw database keys. Use stop names, route names only.
4. **No bullet points or numbered lists**: Structure responses as short paragraphs only. Use bold for emphasis.
5. **Use location automatically**: If the user asks about "near me" or "nearby" and GPS coordinates are available, call \`getNearestStops\` immediately — don't ask them to share location again. If GPS is unavailable, politely ask them to enable location services.
6. **Driver awareness**: If a driver asks about their current trip or route, use the Active Trip context above instead of asking them.
7. **No fake data**: If a tool returns empty results, say so honestly. Never invent stop names or routes.
8. **Formatting & Clean Route Answers**: Use **bold** for stop names and route names. When planning routes, keep it ultra-clean and simple: just mention the route name, start/end stops, and approximate stop count (e.g., "You can take **Route M-10** from **Palasia** to **Vijay Nagar** (about 6 stops)."). Do not dump a long list of intermediate stops.
9. **Proactive**: If you can anticipate what the user needs next, offer it briefly. E.g., after showing nearest stops, suggest "Would you like to check live buses on these routes?"
10. **Transit scope**: You only assist with Indore public transit (GetGo). For unrelated questions, politely redirect: "I'm best at helping with Indore bus routes and stops! How can I help you navigate today?"`;
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

        // Prune message history to keep it under 30 messages (prevents context window bloating)
        if (chatHistoryDoc.messages && chatHistoryDoc.messages.length > 30) {
            chatHistoryDoc.messages = chatHistoryDoc.messages.slice(-30);
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
            response: "Hey! I'm having a brief technical hiccup, but I'm still here. Try asking about bus stops, routes, or live buses — I'll do my best to help!"
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
 * Generate contextual fallback responses when AI is unavailable.
 */
const generateFallbackResponse = (message, userProfile, role, location) => {
    const name = userProfile?.name || "there";
    const lowerMsg = message.toLowerCase();

    if (lowerMsg.includes("hello") || lowerMsg.includes("hi") || lowerMsg.includes("hey") || lowerMsg.includes("namaste")) {
        return `Hey ${name}! 👋 I'm GoBuddy, your GetGo transit assistant. I'm running in lite mode right now, but I can still point you in the right direction. Ask me about bus stops, routes, or schedules!`;
    }

    if (lowerMsg.includes("stop") || lowerMsg.includes("near")) {
        if (location) {
            return `I can see you're near coordinates **${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}**. While my full search is temporarily offline, you can check the **interactive map** on your dashboard to find nearby bus stops in real-time!`;
        }
        return "To find stops near you, please enable your **GPS location** and check the **Bus stops near me** option from the sidebar menu. The live map on your dashboard also shows all nearby stops!";
    }

    if (lowerMsg.includes("route") || lowerMsg.includes("bus") || lowerMsg.includes("palasia") || lowerMsg.includes("vijay nagar")) {
        return `GetGo covers major Indore corridors including **Palasia**, **Vijay Nagar**, **Geeta Bhawan**, **Rajwada**, and **Airport Road**. Check the live map on your dashboard to see active buses and their routes in real-time!`;
    }

    if (lowerMsg.includes("sos") || lowerMsg.includes("emergency") || lowerMsg.includes("police") || lowerMsg.includes("help")) {
        return "For emergencies, dial **112** (National Emergency) or **100** (Police). You can also access quick-dial buttons from the **SOS & Emergency** panel in your sidebar.";
    }

    if (role === "driver" && (lowerMsg.includes("trip") || lowerMsg.includes("broadcast") || lowerMsg.includes("shift"))) {
        return "To start broadcasting your location, go to your **main dashboard** and tap **Start Trip**. Select your route, enter your bus number, and you'll be live for commuters to track!";
    }

    return `Hey ${name}, I'm currently in lite mode and can't process complex queries right now. But you can always check the **live map** on your dashboard for real-time bus locations and stop info. I'll be fully back shortly! 🚌`;
};

module.exports = {
    sendMessage,
    clearHistory
};
