// routes/mcpRoutes.js
const express = require("express");
const router = express.Router();
const Stop = require("../models/stopModel");
const Route = require("../models/routeModel");
const RouteStop = require("../models/routeStopModel");
const busService = require("../services/busService");

let serverInstance = null;
const activeTransports = new Map();

// Initialize the MCP Server dynamically
const getMcpServer = async () => {
    if (serverInstance) return serverInstance;

    try {
        const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
        const { z } = await import("zod");

        const server = new McpServer({
            name: "getgo-transit-server",
            version: "1.0.0"
        });

        // 1. Tool: get_nearest_stops
        server.tool(
            "get_nearest_stops",
            {
                latitude: z.number().describe("Commuter current latitude"),
                longitude: z.number().describe("Commuter current longitude")
            },
            async ({ latitude, longitude }) => {
                try {
                    const nearest = await Stop.find({
                        location: {
                            $nearSphere: {
                                $geometry: {
                                    type: "Point",
                                    coordinates: [longitude, latitude]
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
                            latitude: stop.latitude,
                            longitude: stop.longitude
                        });
                    }
                    return {
                        content: [{ type: "text", text: JSON.stringify(nearestStopsWithRoutes, null, 2) }]
                    };
                } catch (err) {
                    return {
                        content: [{ type: "text", text: `Error: ${err.message}` }],
                        isError: true
                    };
                }
            }
        );

        // 2. Tool: plan_route
        server.tool(
            "plan_route",
            {
                startStopName: z.string().describe("Starting bus stop name (e.g. 'Palasia')"),
                endStopName: z.string().describe("Destination bus stop name (e.g. 'Rajwada')")
            },
            async ({ startStopName, endStopName }) => {
                try {
                    const [startStop, endStop] = await Promise.all([
                        Stop.findOne({ stationName: { $regex: new RegExp(startStopName.trim(), "i") } }),
                        Stop.findOne({ stationName: { $regex: new RegExp(endStopName.trim(), "i") } })
                    ]);

                    if (!startStop || !endStop) {
                        return {
                            content: [{ type: "text", text: `Could not resolve either start stop "${startStopName}" or destination stop "${endStopName}". Please check the spelling.` }],
                            isError: true
                        };
                    }

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

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                startStop: startStop.stationName,
                                endStop: endStop.stationName,
                                routes: plannedRoutes
                            }, null, 2)
                        }]
                    };
                } catch (err) {
                    return {
                        content: [{ type: "text", text: `Error: ${err.message}` }],
                        isError: true
                    };
                }
            }
        );

        // 3. Tool: get_stop_live_buses
        server.tool(
            "get_stop_live_buses",
            {
                stopName: z.string().describe("Bus stop name (e.g. 'Palasia')")
            },
            async ({ stopName }) => {
                try {
                    const stop = await Stop.findOne({ stationName: { $regex: new RegExp(stopName.trim(), "i") } });
                    if (!stop) {
                        return {
                            content: [{ type: "text", text: `Could not find stop named "${stopName}".` }],
                            isError: true
                        };
                    }

                    const routeStops = await RouteStop.find({ stopId: stop._id });
                    const routeIds = routeStops.map(rs => rs.routeId);
                    const routes = await Route.find({ routeId: { $in: routeIds } });
                    const routeMap = new Map(routes.map(r => [r.routeId, r.routeName]));

                    const activeBuses = await busService.getActiveBuses();
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
                                lastUpdated: new Date(bus.updatedAt).toISOString()
                            });
                        }
                    }

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                stopName: stop.stationName,
                                liveBuses: stopBuses
                            }, null, 2)
                        }]
                    };
                } catch (err) {
                    return {
                        content: [{ type: "text", text: `Error: ${err.message}` }],
                        isError: true
                    };
                }
            }
        );

        // 4. Tool: get_route_stops
        server.tool(
            "get_route_stops",
            {
                routeNameOrId: z.string().describe("Route name or ID (e.g. 'Route 9' or '9')")
            },
            async ({ routeNameOrId }) => {
                try {
                    let route = null;
                    const routeId = parseInt(routeNameOrId, 10);
                    
                    if (!isNaN(routeId)) {
                        route = await Route.findOne({ routeId });
                    } else {
                        route = await Route.findOne({ routeName: { $regex: new RegExp(routeNameOrId.trim(), "i") } });
                    }

                    if (!route) {
                        return {
                            content: [{ type: "text", text: `Could not find route matching "${routeNameOrId}".` }],
                            isError: true
                        };
                    }

                    const stops = await RouteStop.find({ routeId: route.routeId }).sort({ stopSequence: 1 });
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                routeId: route.routeId,
                                routeName: route.routeName,
                                stops: stops.map(s => s.stopName)
                            }, null, 2)
                        }]
                    };
                } catch (err) {
                    return {
                        content: [{ type: "text", text: `Error: ${err.message}` }],
                        isError: true
                    };
                }
            }
        );

        // 5. Tool: get_active_buses
        server.tool(
            "get_active_buses",
            {},
            async () => {
                try {
                    const activeBuses = await busService.getActiveBuses();
                    const formatted = activeBuses.map(b => ({
                        busId: b.busId,
                        routeName: b.routeName || `Route ${b.routeId}`,
                        driverPhone: b.driverPhone,
                        latitude: b.lat,
                        longitude: b.lng,
                        lastUpdated: new Date(b.updatedAt).toISOString()
                    }));
                    return {
                        content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }]
                    };
                } catch (err) {
                    return {
                        content: [{ type: "text", text: `Error: ${err.message}` }],
                        isError: true
                    };
                }
            }
        );

        serverInstance = server;
        console.log("[MCP Server] MCP Server initialized and registered 5 tools.");
    } catch (err) {
        console.error("[MCP Server] Error initializing MCP server:", err.message);
    }

    return serverInstance;
};

// GET /api/mcp/sse
router.get("/sse", async (req, res) => {
    try {
        const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js");
        const server = await getMcpServer();

        if (!server) {
            return res.status(500).send("MCP Server not initialized");
        }

        const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const host = req.get('host');
        const messagesUrl = `${protocol}://${host}/api/mcp/messages`;

        console.log(`[MCP SSE] Establishing new client connection. Messages URL: ${messagesUrl}`);
        
        // Disable proxy buffering & compression on Render/Cloudflare to allow direct SSE streaming
        res.setHeader("Content-Encoding", "none");
        res.setHeader("X-Accel-Buffering", "no");

        const transport = new SSEServerTransport(messagesUrl, res);
        await server.connect(transport);

        const sessionId = transport.sessionId;
        if (sessionId) {
            activeTransports.set(sessionId, transport);
            console.log(`[MCP SSE] Session registered: ${sessionId}. Total sessions: ${activeTransports.size}`);
        }

        req.on("close", () => {
            console.log(`[MCP SSE] Client connection closed for session: ${sessionId}`);
            if (sessionId) {
                activeTransports.delete(sessionId);
            }
        });
    } catch (err) {
        console.error("[MCP SSE] Connection error:", err.message);
        res.status(500).send(err.message);
    }
});

// POST /api/mcp/messages
router.post("/messages", async (req, res) => {
    try {
        const sessionId = req.query.sessionId;
        if (!sessionId) {
            return res.status(400).send("Missing sessionId query parameter");
        }

        const transport = activeTransports.get(sessionId);
        if (!transport) {
            return res.status(404).send(`No active SSE transport connection found for session: ${sessionId}`);
        }

        await transport.handlePostMessage(req, res);
    } catch (err) {
        console.error("[MCP Message] Error handling JSON-RPC message:", err.message);
        res.status(500).send(err.message);
    }
});

module.exports = router;
