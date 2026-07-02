// controllers/supportToolsController.js
const Stop = require("../models/stopModel");
const Route = require("../models/routeModel");
const RouteStop = require("../models/routeStopModel");
const busService = require("../services/busService");

/**
 * Helper to normalize and resolve common spelling variations for Indore stops.
 */
const normalizeStopSearchName = (name) => {
    if (!name) return "";
    let clean = name.toLowerCase().trim();
    
    // Normalize spelling variants
    clean = clean.replace(/palasia/g, "palasiya");
    clean = clean.replace(/bhawan/g, "bhavan");
    clean = clean.replace(/vijaynagar/g, "vijay nagar");
    
    // Escape regex special characters
    return clean.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
};

/**
 * Helper to calculate intermediate stops on a route between startStop and endStop sequences.
 */
const getIntermediateStops = async (routeId, startSeq, endSeq) => {
    try {
        return await RouteStop.find({
            routeId,
            stopSequence: { $gte: startSeq, $lte: endSeq }
        }).sort({ stopSequence: 1 }).lean();
    } catch (err) {
        console.error("Error getting intermediate stops:", err.message);
        return [];
    }
};

/**
 * GET /api/support/tools/stops/nearest
 * Query: latitude, longitude, limit (optional, default 3)
 */
const getNearestStopsTool = async (req, res) => {
    const { latitude, longitude, limit } = req.query;

    if (!latitude || !longitude) {
        return res.status(400).json({ success: false, message: "latitude and longitude are required query parameters" });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const stopLimit = parseInt(limit, 10) || 3;

    if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ success: false, message: "Invalid coordinates provided" });
    }

    try {
        const nearest = await Stop.find({
            location: {
                $nearSphere: {
                    $geometry: {
                        type: "Point",
                        coordinates: [lng, lat]
                    }
                }
            }
        }).limit(stopLimit).maxTimeMS(3000).lean();

        const results = [];
        for (const stop of nearest) {
            const routeStops = await RouteStop.find({ stopId: stop._id }).lean();
            const routeIds = routeStops.map(rs => rs.routeId);
            const routes = await Route.find({ routeId: { $in: routeIds } }).lean();

            results.push({
                stopId: stop._id,
                stopName: stop.stationName,
                latitude: stop.latitude,
                longitude: stop.longitude,
                routes: routes.map(r => r.routeName)
            });
        }

        res.status(200).json({ success: true, stops: results });
    } catch (error) {
        console.error("getNearestStopsTool error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/support/tools/stops/search
 * Query: q (stop name query)
 */
const searchStopsTool = async (req, res) => {
    const { q } = req.query;

    if (!q) {
        return res.status(200).json({ success: true, stops: [] });
    }

    try {
        const query = normalizeStopSearchName(q);
        const stops = await Stop.find({
            stationName: { $regex: query, $options: "i" }
        }).limit(10).lean();

        res.status(200).json({ success: true, stops });
    } catch (error) {
        console.error("searchStopsTool error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/support/tools/routes/stops
 * Query: routeId (numeric ID of route)
 */
const getRouteStopsTool = async (req, res) => {
    const { routeId } = req.query;

    if (!routeId) {
        return res.status(400).json({ success: false, message: "routeId query parameter is required" });
    }

    const numericRouteId = parseInt(routeId, 10);
    if (isNaN(numericRouteId)) {
        return res.status(400).json({ success: false, message: "routeId must be numeric" });
    }

    try {
        const stops = await RouteStop.find({ routeId: numericRouteId })
            .sort({ stopSequence: 1 }).lean();

        res.status(200).json({ success: true, stops });
    } catch (error) {
        console.error("getRouteStopsTool error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/support/tools/routes/plan
 * Query: startStopName, endStopName, startLat, startLng, endLat, endLng
 */
const planRouteTool = async (req, res) => {
    const { startStopName, endStopName, startLat, startLng, endLat, endLng } = req.query;

    try {
        let startStop = null;
        let endStop = null;

        // 1. Resolve start stop
        if (startStopName) {
            const queryStart = normalizeStopSearchName(startStopName);
            // Prefer exact case-insensitive match
            startStop = await Stop.findOne({ stationName: { $regex: `^${queryStart}$`, $options: "i" } });
            if (!startStop) {
                startStop = await Stop.findOne({ stationName: { $regex: queryStart, $options: "i" } });
            }
        } else if (startLat && startLng) {
            const lat = parseFloat(startLat);
            const lng = parseFloat(startLng);
            if (!isNaN(lat) && !isNaN(lng)) {
                startStop = await Stop.findOne({
                    location: {
                        $nearSphere: {
                            $geometry: { type: "Point", coordinates: [lng, lat] }
                        }
                    }
                });
            }
        }

        // 2. Resolve destination stop
        if (endStopName) {
            const queryEnd = normalizeStopSearchName(endStopName);
            // Prefer exact case-insensitive match
            endStop = await Stop.findOne({ stationName: { $regex: `^${queryEnd}$`, $options: "i" } });
            if (!endStop) {
                endStop = await Stop.findOne({ stationName: { $regex: queryEnd, $options: "i" } });
            }
        } else if (endLat && endLng) {
            const lat = parseFloat(endLat);
            const lng = parseFloat(endLng);
            if (!isNaN(lat) && !isNaN(lng)) {
                endStop = await Stop.findOne({
                    location: {
                        $nearSphere: {
                            $geometry: { type: "Point", coordinates: [lng, lat] }
                        }
                    }
                });
            }
        }

        if (!startStop || !endStop) {
            return res.status(404).json({
                success: false,
                message: `Could not resolve start stop (${startStopName || 'coords'}) or destination stop (${endStopName || 'coords'}).`
            });
        }

        if (startStop._id.toString() === endStop._id.toString()) {
            return res.status(200).json({
                success: true,
                startStop,
                endStop,
                routes: []
            });
        }

        // 3. Find routes that contain both stops in proper order (startStop sequence < endStop sequence)
        const startRouteStops = await RouteStop.find({ stopId: startStop._id }).lean();
        const endRouteStops = await RouteStop.find({ stopId: endStop._id }).lean();

        const startMap = new Map();
        for (const rs of startRouteStops) {
            startMap.set(rs.routeId, rs.stopSequence);
        }

        const matchingRoutes = [];
        for (const rs of endRouteStops) {
            const routeId = rs.routeId;
            if (startMap.has(routeId)) {
                const startSeq = startMap.get(routeId);
                const endSeq = rs.stopSequence;
                if (startSeq < endSeq) {
                    const route = await Route.findOne({ routeId }).lean();
                    if (route) {
                        const intermediateStops = await getIntermediateStops(routeId, startSeq, endSeq);
                        matchingRoutes.push({
                            routeId,
                            routeName: route.routeName,
                            startSequence: startSeq,
                            endSequence: endSeq,
                            numStops: endSeq - startSeq,
                            stops: intermediateStops.map(s => s.stopName)
                        });
                    }
                }
            }
        }

        res.status(200).json({
            success: true,
            startStop: startStop.stationName,
            endStop: endStop.stationName,
            routes: matchingRoutes
        });

    } catch (error) {
        console.error("planRouteTool error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/support/tools/buses/live
 * Query: routeId (optional), stopName (optional)
 */
const getLiveBusesTool = async (req, res) => {
    const { routeId, stopName } = req.query;

    try {
        const activeBuses = await busService.getActiveBuses();
        let filteredBuses = activeBuses;

        // 1. Filter by routeId if provided
        if (routeId) {
            const rid = parseInt(routeId, 10);
            if (!isNaN(rid)) {
                filteredBuses = filteredBuses.filter(b => b.routeId === rid);
            }
        }

        // 2. Filter by stopName if provided
        if (stopName) {
            const stop = await Stop.findOne({ stationName: { $regex: stopName.trim(), $options: "i" } });
            if (stop) {
                const routeStops = await RouteStop.find({ stopId: stop._id }).lean();
                const routeIds = new Set(routeStops.map(rs => rs.routeId));
                filteredBuses = filteredBuses.filter(b => b.routeId && routeIds.has(b.routeId));
            } else {
                // If stop name not resolved, return empty list
                filteredBuses = [];
            }
        }

        const results = filteredBuses.map(b => ({
            busId: b.busId,
            routeId: b.routeId,
            routeName: b.routeName,
            driverPhone: b.driverPhone,
            latitude: b.lat,
            longitude: b.lng,
            lastUpdated: b.updatedAt
        }));

        res.status(200).json({ success: true, buses: results });
    } catch (error) {
        console.error("getLiveBusesTool error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    getNearestStopsTool,
    searchStopsTool,
    getRouteStopsTool,
    planRouteTool,
    getLiveBusesTool
};
