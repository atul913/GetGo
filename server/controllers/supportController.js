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
 * Build the system prompt with full user context and platform knowledge.
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

    return `You are GoBuddy, the intelligent AI transit & navigation copilot for the GetGo platform in Indore, India. You are concise, helpful, and precise.

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

GETGO PLATFORM CAPABILITIES & FEATURES:
1. Commuter Dashboard Features:
   - Trip/Route Planner: Connects any two points in Indore, computes multimodal route combinations (walking/auto + bus), calculates transit fares (₹10 base + ₹2 per stop), estimates travel times, and draws interactive Google-Maps styled paths on the Leaflet map.
   - Live Interactive Map: Real-time GPS bus tracking with live position indicators and animated route polylines.
   - Stop Explorer: Live arrival board for all stops in Indore (Palasia, Bhanwarkua, Vijay Nagar, Geeta Bhawan, Rajwada, Radisson, MR 10, Chhappan, etc.) with minute-by-minute countdowns.
   - Live Bus Progress Sheet: Stop-by-stop vertical progress line tracking the active bus.
   - Emergency SOS Panel: Direct one-tap helplines for Police (112 / 100), Women's Helpline (1090), Ambulance (108), and Indore City Bus Transit Helpline (0731-4045210).
   - Profile & Preferences: Profile photo crop & upload, name/age/gender edit, Language switch (English / Hindi), and Privacy/Consent toggle controls.

2. Driver Dashboard Features:
   - Live Location Broadcasting: Shift management with assigned routes (e.g. Route 3, 11A, 303), bus license plate registration, and real-time GPS telemetry broadcast to commuters.
   - Driver Telemetry: Speedometer, passenger load counter, route adherence alerts, and depot helpline dispatch.

3. Indore Transit Geography & Major Corridors:
   - Route Types: M-xx (Metro/Main Routes), R-xx (Ring Road Routes), C-xx (City Core Routes), N-xx (Night Routes).
   - Major Landmarks & Colleges: Acropolis Institute (near Bypass / Mangliya / Radisson hub), Medicaps University (Rau / AB Road), IIM Indore (Pigdamber / Rau), DAVV & Holkar College (Bhanwarkuan), C21 & Malhar Mega Mall (Vijay Nagar), Phoenix Citadel (MR 10 / Bypass), Sarafa Bazaar & Rajwada, Chhappan 56 Dukan (Palasia), Sarwate Bus Stand & Railway Station, Gangwal Bus Stand.

Available Tools:
1. \`getNearestStops\`: Finds nearest stops to a lat/lng.
2. \`searchStops\`: Finds stops matching text or landmark queries.
3. \`getRouteStops\`: Lists stops for a route ID.
4. \`planRoute\`: Connects two stops (by name or coordinates) and resolves routes & active buses.
5. \`getLiveBuses\`: Gets real-time active buses and their arrival window.

CORE DIRECTIVES & FORMATTING:
1. NO EMOJIS: Never output any emojis in your response text under any circumstances.
2. ONE-LINER GREETINGS: When the user says hi/hello or a basic greeting, reply with a single concise sentence (e.g. "Hello ${userName}, how can I help you navigate Indore transit today?").
3. AUTOMATED DESTINATION NAVIGATION & TRIP PLANNING:
   - When a user asks how to go to any place, landmark, college, or area (e.g. "take me to Acropolis", "how to reach Vijay Nagar", "how can i go to 56 dukan"):
   - Do NOT ask for starting location. Immediately use the User's GPS Location from context.
   - Use \`planRoute\` or \`searchStops\` to identify the route and next bus arrival.
   - In your final response text:
     - Name the boarding stop, destination/hub stop, and route name.
     - State next bus arrival time (or "No active buses are currently tracked on this route in the next 20 minutes" if none are active).
   - MUST append the action directive on a new line:
     ACTION: {"type": "PLAN_ROUTE", "destination": "<Destination Name>"}
4. UI ACTION DIRECTIVES:
   Whenever appropriate, you can trigger UI redirection on the user's dashboard by placing an action directive on the last line of your response:
   - Route Planning: ACTION: {"type": "PLAN_ROUTE", "destination": "Acropolis"}
   - View Specific Stop: ACTION: {"type": "VIEW_STOP", "stopName": "Palasia"}
   - Open Live Map / Live Buses: ACTION: {"type": "VIEW_LIVE_MAP"}
   - Emergency / SOS: ACTION: {"type": "OPEN_SOS"}
   - Settings / Profile / Language / Privacy: ACTION: {"type": "OPEN_SETTINGS", "view": "editProfileView" | "languageView" | "consentView" | "settingsView"}
   - Driver Shift Broadcast: ACTION: {"type": "DRIVER_START_TRIP"}
5. SHORT PARAGRAPHS: Keep responses crisp and direct (1-3 sentences maximum). No raw database keys or ObjectIDs.`;
};

/**
 * Helper to extract action directive from AI response.
 */
const extractActionFromText = (text) => {
    if (!text) return { cleanText: "", action: null };

    const actionRegex = /ACTION:\s*(\{.*?\})/i;
    const match = text.match(actionRegex);

    if (match) {
        try {
            const action = JSON.parse(match[1]);
            const cleanText = text.replace(actionRegex, '').trim();
            return { cleanText, action };
        } catch (e) {
            console.warn("[Support API] Failed to parse action JSON:", e.message);
        }
    }

    return { cleanText: text.trim(), action: null };
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

        // Prune message history to keep it under 14 messages (prevents context window bloating)
        if (chatHistoryDoc.messages && chatHistoryDoc.messages.length > 14) {
            chatHistoryDoc.messages = chatHistoryDoc.messages.slice(-14);
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

        let rawResponseText = "";
        try {
            // Execute AI response loop with local tool calling
            const chatResponse = await aiService.getChatResponse(apiMessages);
            rawResponseText = chatResponse.text;
            // Clean any residual emojis
            rawResponseText = rawResponseText.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu, '').trim();
        } catch (aiError) {
            console.warn("[Support API] AI Service unavailable, generating fallback response:", aiError.message);
            rawResponseText = generateFallbackResponse(message, userProfile, role, normalizedLocation);
        }

        // Extract any action payload
        const { cleanText, action } = extractActionFromText(rawResponseText);
        const finalResponseText = cleanText || rawResponseText;

        // Update database chat history in human/ai format
        chatHistoryDoc.messages.push({
            type: "human",
            data: { content: message }
        });
        chatHistoryDoc.messages.push({
            type: "ai",
            data: { content: finalResponseText }
        });

        try {
            await chatHistoryDoc.save();
        } catch (dbSaveErr) {
            console.warn(`[Support API] Support chat history save failed. Error: ${dbSaveErr.message}`);
        }

        res.status(200).json({
            success: true,
            response: finalResponseText,
            action: action || null
        });

    } catch (error) {
        console.error("Support controller error:", error.message);

        res.status(200).json({
            success: true,
            response: "I am having a brief technical delay. Please check your dashboard map for live bus routes.",
            action: { type: "VIEW_LIVE_MAP" }
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

    if (lowerMsg.includes("acropolis") || lowerMsg.includes("medicaps") || lowerMsg.includes("college") || lowerMsg.includes("plan") || lowerMsg.includes("reach") || lowerMsg.includes("go to") || lowerMsg.includes("route")) {
        let dest = "Indore";
        if (lowerMsg.includes("acropolis")) dest = "Acropolis";
        else if (lowerMsg.includes("medicaps")) dest = "Medicaps";
        else if (lowerMsg.includes("vijay nagar")) dest = "Vijay Nagar";
        else if (lowerMsg.includes("palasia")) dest = "Palasia";
        else if (lowerMsg.includes("56 dukan") || lowerMsg.includes("chhappan")) dest = "56 Dukan";
        return `You can plan your transit to ${dest} directly using our interactive Route Planner.\nACTION: {"type": "PLAN_ROUTE", "destination": "${dest}"}`;
    }

    if (lowerMsg.includes("stop") || lowerMsg.includes("near")) {
        if (location) {
            return `Nearest stops around your location are available on your live dashboard map.\nACTION: {"type": "VIEW_LIVE_MAP"}`;
        }
        return "Please enable GPS location to view bus stops near your current location.\nACTION: {"type": "VIEW_LIVE_MAP"}";
    }

    if (lowerMsg.includes("sos") || lowerMsg.includes("emergency") || lowerMsg.includes("police") || lowerMsg.includes("help") || lowerMsg.includes("ambulance")) {
        return "For emergency assistance, dial 112 or use the SOS panel in the sidebar.\nACTION: {"type": "OPEN_SOS"}";
    }

    if (lowerMsg.includes("profile") || lowerMsg.includes("name") || lowerMsg.includes("photo")) {
        return "You can edit your profile details and photo in Account Settings.\nACTION: {"type": "OPEN_SETTINGS", "view": "editProfileView"}";
    }

    if (lowerMsg.includes("language") || lowerMsg.includes("hindi")) {
        return "You can toggle between English and Hindi in Language Settings.\nACTION: {"type": "OPEN_SETTINGS", "view": "languageView"}";
    }

    if (role === "driver" && (lowerMsg.includes("trip") || lowerMsg.includes("broadcast") || lowerMsg.includes("start"))) {
        return "To broadcast your location, tap Start Trip on your driver dashboard.\nACTION: {"type": "DRIVER_START_TRIP"}";
    }

    return "Live bus positions and stops can be viewed directly on your interactive map.\nACTION: {"type": "VIEW_LIVE_MAP"}";
};

module.exports = {
    sendMessage,
    clearHistory
};
