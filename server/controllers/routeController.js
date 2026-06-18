// controllers/routeController.js
const Route = require("../models/routeModel");
const RouteStop = require("../models/routeStopModel");
const Stop = require("../models/stopModel");

// Helper to find the nearest stop to a given coordinate
const findNearestStopToCoords = async (lat, lng) => {
    const stops = await Stop.find({
        location: {
            $nearSphere: {
                $geometry: {
                    type: "Point",
                    coordinates: [lng, lat]
                }
            }
        }
    }).limit(1);
    return stops[0] || null;
};

// Get all routes
const getAllRoutes = async (req, res) => {
    try {
        const routes = await Route.find({}).sort({ routeId: 1 });
        res.status(200).json({ success: true, routes });
    } catch (error) {
        console.error("getAllRoutes error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get all stops of a specific route in sequence
const getRouteStops = async (req, res) => {
    const { routeId } = req.params;

    if (!routeId) {
        return res.status(400).json({ success: false, message: "routeId path parameter is required" });
    }

    const numericRouteId = parseInt(routeId, 10);
    if (isNaN(numericRouteId)) {
        return res.status(400).json({ success: false, message: "Invalid routeId provided (must be numeric)" });
    }

    try {
        // Find route stops in sequence directly using denormalized fields
        const routeStops = await RouteStop.find({ routeId: numericRouteId })
            .sort({ stopSequence: 1 });

        if (routeStops.length === 0) {
            return res.status(404).json({ success: false, message: "No stops found for this route" });
        }

        res.status(200).json({ success: true, stops: routeStops });
    } catch (error) {
        console.error("getRouteStops error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Plan routes between two locations
const planRoute = async (req, res) => {
    const { startStopId, endStopId, startLat, startLng, endLat, endLng } = req.query;

    try {
        let startStop = null;
        let endStop = null;

        // 1. Resolve starting stop
        if (startStopId) {
            startStop = await Stop.findById(startStopId);
        } else if (startLat && startLng) {
            const lat = parseFloat(startLat);
            const lng = parseFloat(startLng);
            if (!isNaN(lat) && !isNaN(lng)) {
                startStop = await findNearestStopToCoords(lat, lng);
            }
        }

        // 2. Resolve destination stop
        if (endStopId) {
            endStop = await Stop.findById(endStopId);
        } else if (endLat && endLng) {
            const lat = parseFloat(endLat);
            const lng = parseFloat(endLng);
            if (!isNaN(lat) && !isNaN(lng)) {
                endStop = await findNearestStopToCoords(lat, lng);
            }
        }

        if (!startStop || !endStop) {
            return res.status(400).json({ success: false, message: "Could not resolve starting or destination stops." });
        }

        // If starting stop and ending stop are the same, return empty list
        if (startStop._id.toString() === endStop._id.toString()) {
            return res.status(200).json({
                success: true,
                startStop,
                endStop,
                routes: []
            });
        }

        // 3. Find routes that contain both stops
        const startRouteStops = await RouteStop.find({ stopId: startStop._id });
        const endRouteStops = await RouteStop.find({ stopId: endStop._id });

        // Map routeId to sequence
        const startMap = new Map();
        for (const rs of startRouteStops) {
            startMap.set(rs.routeId, rs.stopSequence);
        }

        const matchingRoutes = [];

        // Check which routes are common and start sequence < end sequence
        for (const rs of endRouteStops) {
            const routeId = rs.routeId;
            if (startMap.has(routeId)) {
                const startSeq = startMap.get(routeId);
                const endSeq = rs.stopSequence;
                if (startSeq < endSeq) {
                    const route = await Route.findOne({ routeId });
                    if (route) {
                        const intermediateRouteStops = await RouteStop.find({
                            routeId,
                            stopSequence: { $gte: startSeq, $lte: endSeq }
                        }).sort({ stopSequence: 1 });

                        matchingRoutes.push({
                            routeId,
                            routeName: route.routeName,
                            startSequence: startSeq,
                            endSequence: endSeq,
                            numStops: endSeq - startSeq,
                            stops: intermediateRouteStops
                        });
                    }
                }
            }
        }

        res.status(200).json({
            success: true,
            startStop,
            endStop,
            routes: matchingRoutes
        });

    } catch (error) {
        console.error("planRoute error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getAllRoutes, getRouteStops, planRoute };
