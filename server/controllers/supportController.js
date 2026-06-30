// controllers/supportController.js
const axios = require("axios");
const User = require("../models/userModel");
const Stop = require("../models/stopModel");
const Route = require("../models/routeModel");
const RouteStop = require("../models/routeStopModel");
const busService = require("../services/busService");

// In-memory cache for stops and routes to make parsing instantaneous
let stopsCache = null;
let routesCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache TTL

const getCachedStopsAndRoutes = async () => {
    const now = Date.now();
    if (stopsCache && routesCache && (now - cacheTimestamp < CACHE_TTL)) {
        return { stops: stopsCache, routes: routesCache };
    }
    
    try {
        const [routes, stops] = await Promise.all([
            Route.find({}).lean().maxTimeMS(2000),
            Stop.find({}, { stationName: 1, latitude: 1, longitude: 1 }).lean().maxTimeMS(2000)
        ]);
        
        routesCache = routes;
        // Sort stops by length descending so we match longer names first
        stopsCache = stops.sort((a, b) => b.stationName.length - a.stationName.length);
        cacheTimestamp = now;
        
        console.log(`[Support API] Cached ${routesCache.length} routes and ${stopsCache.length} stops for query parser.`);
    } catch (err) {
        console.error("[Support API] Failed to refresh stops/routes cache:", err.message);
        routesCache = routesCache || [];
        stopsCache = stopsCache || [];
    }
    
    return { stops: stopsCache, routes: routesCache };
};

/**
 * POST /api/support/message
 * Sends user message along with user context and active buses to n8n AI Agent.
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
            userProfile = await User.findOne({ phone, role }).maxTimeMS(3000);
        } catch (dbErr) {
            console.warn(`[Support API] DB profile fetch failed (using session defaults). Error: ${dbErr.message}`);
        }

        // Fetch active buses in transit system
        let activeBuses = [];
        try {
            activeBuses = await busService.getActiveBuses();
        } catch (busErr) {
            console.error("Error retrieving active buses in supportController:", busErr.message);
        }

        // Construct transitContext
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

        const transitContext = {
            activeBuses: activeBuses.map(b => ({
                busId: b.busId,
                driverPhone: b.driverPhone,
                routeId: b.routeId,
                routeName: b.routeName,
                lat: b.lat,
                lng: b.lng,
                lastUpdated: b.updatedAt
            })),
            userReportedLocation: normalizedLocation,
            systemTime: new Date().toISOString(),
            nearestStops: [],
            plannedRoute: null,
            searchedStop: null,
            searchedRoute: null
        };

        // 1. Dynamic Nearest Stops (If Location coordinates are provided)
        if (normalizedLocation) {
            try {
                const { lat, lng } = normalizedLocation;
                const nearest = await Stop.find({
                    location: {
                        $nearSphere: {
                            $geometry: {
                                type: "Point",
                                coordinates: [lng, lat]
                            }
                        }
                    }
                }).limit(3).maxTimeMS(3000);

                const nearestStopsWithRoutes = [];
                for (const stop of nearest) {
                    const routeStops = await RouteStop.find({ stopId: stop._id });
                    const routeIds = routeStops.map(rs => rs.routeId);
                    const routes = await Route.find({ routeId: { $in: routeIds } });
                    const routeNames = routes.map(r => r.routeName);
                    nearestStopsWithRoutes.push({
                        name: stop.stationName,
                        routes: routeNames.length > 4 ? [...routeNames.slice(0, 4), "..."] : routeNames,
                        lat: stop.latitude,
                        lng: stop.longitude
                    });
                }
                transitContext.nearestStops = nearestStopsWithRoutes;
            } catch (stopErr) {
                console.warn(`[Support API] Error finding nearest stops: ${stopErr.message}`);
            }
        }

        // 2. Intelligent Search Parser on User Query
        const cleanMessage = message.toLowerCase();

        // Fetch stops and routes from cache (instantaneous)
        const { stops: sortedAllStops, routes: allRoutes } = await getCachedStopsAndRoutes();

        // 2a. Find matches for route IDs or names in the message
        let matchedRoute = null;
        for (const route of allRoutes) {
            const nameLower = route.routeName.toLowerCase();
            const idStr = route.routeId.toString();
            if (cleanMessage.includes(nameLower) || 
                cleanMessage.includes(`route ${idStr}`) || 
                cleanMessage.includes(`bus ${idStr}`) ||
                cleanMessage.endsWith(` ${idStr}`) || 
                cleanMessage.includes(` ${idStr} `)) {
                matchedRoute = route;
                break;
            }
        }

        if (matchedRoute) {
            try {
                const routeStops = await RouteStop.find({ routeId: matchedRoute.routeId }).sort({ stopSequence: 1 });
                transitContext.searchedRoute = {
                    routeId: matchedRoute.routeId,
                    routeName: matchedRoute.routeName,
                    stops: routeStops.map(rs => rs.stopName)
                };
            } catch (err) {
                console.warn(`[Support API] Route stops load failed: ${err.message}`);
            }
        }

        // 2b. Find matches for stops mentioned in the message
        let remainingMessage = cleanMessage;
        const matchedStops = [];
        for (const stop of sortedAllStops) {
            const stopNameLower = stop.stationName.toLowerCase();
            if (remainingMessage.includes(stopNameLower)) {
                matchedStops.push(stop);
                remainingMessage = remainingMessage.replace(stopNameLower, "");
            }
        }

        if (matchedStops.length >= 2) {
            // Respect the order of occurrence in the query (from X to Y)
            matchedStops.sort((a, b) => cleanMessage.indexOf(a.stationName.toLowerCase()) - cleanMessage.indexOf(b.stationName.toLowerCase()));
            const startStop = matchedStops[0];
            const endStop = matchedStops[1];

            try {
                const startRouteStops = await RouteStop.find({ stopId: startStop._id });
                const endRouteStops = await RouteStop.find({ stopId: endStop._id });

                const startMap = new Map();
                for (const rs of startRouteStops) {
                    startMap.set(rs.routeId, rs.stopSequence);
                }

                const plannedRoutes = [];
                for (const rs of endRouteStops) {
                    const routeId = rs.routeId;
                    if (startMap.has(routeId)) {
                        const startSeq = startMap.get(routeId);
                        const endSeq = rs.stopSequence;
                        if (startSeq < endSeq) {
                            const route = await Route.findOne({ routeId });
                            if (route) {
                                plannedRoutes.push({
                                    routeId,
                                    routeName: route.routeName,
                                    stopsCount: endSeq - startSeq
                                });
                            }
                        }
                    }
                }

                transitContext.plannedRoute = {
                    startStop: startStop.stationName,
                    endStop: endStop.stationName,
                    routes: plannedRoutes
                };
            } catch (routeErr) {
                console.warn(`[Support API] Route planning failed: ${routeErr.message}`);
            }
        } else if (matchedStops.length === 1) {
            const stop = matchedStops[0];
            try {
                const routeStops = await RouteStop.find({ stopId: stop._id });
                const routeIds = routeStops.map(rs => rs.routeId);
                const routes = await Route.find({ routeId: { $in: routeIds } });
                const routeMap = new Map(routes.map(r => [r.routeId, r.routeName]));

                const stopBuses = [];
                for (const bus of activeBuses) {
                    let isMatch = false;
                    let matchedRouteName = "";
                    if (bus.routeId && routeIds.includes(bus.routeId)) {
                        isMatch = true;
                        matchedRouteName = routeMap.get(bus.routeId) || `Route ${bus.routeId}`;
                    } else {
                        const busIdClean = bus.busId.split(" ")[0].replace(/[:-]+$/, "").toLowerCase();
                        for (const route of routes) {
                            const routeCode = route.routeName.split(" ")[0].replace(/[:-]+$/, "").toLowerCase();
                            if (busIdClean === routeCode || bus.busId.toLowerCase().includes(routeCode)) {
                                isMatch = true;
                                matchedRouteName = route.routeName;
                                break;
                            }
                        }
                    }
                    if (isMatch) {
                        stopBuses.push({
                            busId: bus.busId,
                            routeName: matchedRouteName,
                            lastUpdated: bus.updatedAt
                        });
                    }
                }

                transitContext.searchedStop = {
                    name: stop.stationName,
                    servingRoutes: routes.map(r => r.routeName),
                    liveBuses: stopBuses
                };
            } catch (stopErr) {
                console.warn(`[Support API] Stop query failed: ${stopErr.message}`);
            }
        }

        // Construct payload context for n8n
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
            transitContext
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
            // Support various formats returned by n8n (e.g. output, response, text, message)
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
