// controllers/supportController.js
const User = require("../models/userModel");
const ChatHistory = require("../models/chatHistoryModel");
const aiService = require("../services/aiService");

/**
 * POST /api/support/message
 * Sends user message along with user context to the Groq AI agent, executing tools locally.
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

        // Retrieve or initialize persistent support chat history from database
        let chatHistoryDoc = null;
        try {
            chatHistoryDoc = await ChatHistory.findOne({ sessionId: phone });
        } catch (dbErr) {
            console.warn(`[Support API] Support chat history fetch failed. Error: ${dbErr.message}`);
        }

        if (!chatHistoryDoc) {
            chatHistoryDoc = new ChatHistory({ sessionId: phone, messages: [] });
        }

        // Prune message history to keep it under 30 messages (prevents context window bloating)
        if (chatHistoryDoc.messages && chatHistoryDoc.messages.length > 30) {
            chatHistoryDoc.messages = chatHistoryDoc.messages.slice(-30);
        }

        // Construct dynamic system prompt containing user context and transit conditions
        const systemPrompt = `You are the GetGo Customer Support Agent, a friendly, professional, and helpful human-like transit assistant.
Your goal is to help commuters and drivers with real-time transit queries about Indore's GetGo public transit system (buses, stops, routes, and schedules).

User Profile:
- Name: ${userProfile?.name || "GetGo User"}
- Phone: ${userProfile?.phone || phone}
- Role: ${userProfile?.role || role}

Transit Context:
- User's Current Location (Lat/Lng): ${normalizedLocation ? `${normalizedLocation.lat}, ${normalizedLocation.lng}` : "Unknown"}
- System Time: ${new Date().toISOString()}

Indore transit routes follow standard prefixes:
- **M-xx** (Metro/Main Routes)
- **R-xx** (Ring Road Routes)
- **C-xx** (City Core Routes)
- **N-xx** (Night Routes)

You have access to these real-time tools:
1. \`getNearestStops\`: Finds public transit stops nearest to a latitude/longitude.
2. \`searchStops\`: Finds stops matching a text query (handles Indore spelling variations like Palasia/Palasiya).
3. \`getRouteStops\`: Lists all stops sequentially along a route ID.
4. \`planRoute\`: Connects two stops, resolving routes that link them.
5. \`getLiveBuses\`: Gets real-time GPS locations and details of active buses.

STRICT OPERATIONAL DIRECTIVES:
1. **Human Support Persona**: Speak like a friendly customer service representative. Personalize greetings using the user's name if they say hello (e.g. "Hello ${userProfile?.name || 'Atul'}, how can I help you navigate Indore today?").
2. **Conciseness**: Keep replies short and direct. commuters are on the go. Avoid long explanations.
3. **No Database Keys**: Never show raw MongoDB ObjectIDs (e.g., \`6a42111...\`) in responses. They are confusing and clutter the UI. Always refer to stops by their names (e.g., **Palasia**, **Dawa Bazar**).
4. **Markdown Formatting (Short Paragraphs Only)**:
   - **DO NOT use bullet points (e.g. *, -) or numbered lists (e.g. 1., 2.) under any circumstances.**
   - Always structure your responses as **short, distinct paragraphs** of text. Limit each paragraph to 2-3 sentences maximum.
   - **Nearest Stops**: Describe nearest stops in a short paragraph block, specifying their names, rounded distances, and serving routes. E.g.:
     "The nearest stop is **Dawa Bazar**, located 0.23 km away, which is served by routes **M-10** and **R-17**. You can also find **Madhu Milan**, which is 0.26 km away and served by route **C-04**."
   - **Planned Routes**: Describe planned routes in a short paragraph format using bold stop names and arrows. E.g.:
     "To go from **Palasia** to **Dawa Bazar**, you can take **Route R-17**. The path is **Palasia** ➔ **Geeta Bhawan** ➔ **Dawa Bazar** (3 stops total)."
   - **Live Buses**: If a bus is active, specify it in a brief paragraph. E.g.:
     "Bus **MP-09-AB-1234** is active on **Route M-10** (last updated 2 mins ago)."
5. **Robust Location Fallback**: When the user asks for nearest stops or asks about stops "near me", check if the User's Current Location coordinates are "Unknown". If coordinates are available, call \`getNearestStops\` using those coordinates. If coordinates are "Unknown", ask the user to share their location or specify a stop name.
6. **No Fake Data**: Do not make up stop names, routes, or live bus statuses. If a tool returns no results, politely tell the user that no records were found in the Indore GetGo system for their search query.`;

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

        // Execute AI response loop with local tool calling
        const chatResponse = await aiService.getChatResponse(apiMessages);

        // Update database chat history in human/ai format
        chatHistoryDoc.messages.push({
            type: "human",
            data: { content: message }
        });
        chatHistoryDoc.messages.push({
            type: "ai",
            data: { content: chatResponse.text }
        });
        
        try {
            await chatHistoryDoc.save();
        } catch (dbSaveErr) {
            console.warn(`[Support API] Support chat history save failed. Error: ${dbSaveErr.message}`);
        }

        res.status(200).json({
            success: true,
            response: chatResponse.text
        });

    } catch (error) {
        console.error("Support controller error:", error.message);
        
        let errorMsg = "Could not connect to the GetGo AI Customer Support agent.";
        if (error.message.includes("GROQ_API_KEY")) {
            errorMsg = "Support agent API key is not configured on the server.";
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

