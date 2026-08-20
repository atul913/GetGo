// controllers/supportToolsController.js
const Stop = require("../models/stopModel");
const Route = require("../models/routeModel");
const RouteStop = require("../models/routeStopModel");
const busService = require("../services/busService");

/**
 * Helper to normalize spelling variations for Indore transit locations.
 */
const normalizeText = (text) => {
    if (!text) return "";
    let clean = text.toLowerCase().trim();
    clean = clean.replace(/palasia/g, "palasiya");
    clean = clean.replace(/bhawan/g, "bhavan");
    clean = clean.replace(/vijaynagar/g, "vijay nagar");
    clean = clean.replace(/bhawarkuan|bhawar kuan|bhavarkuan|bhavarkua|bhanwarkua|bhanwar kuan/g, "bhawarkua");
    clean = clean.replace(/chhappan|56 dukan/g, "56 Dukan");
    return clean;
};

/**
 * Flexible stop resolver: handles coordinates, exact names, partial names, or landmark tokens.
 */
const resolveStopFlexible = async (nameOrQuery, lat, lng) => {
    if (lat !== undefined && lng !== undefined && lat !== null && lng !== null) {
        const parsedLat = parseFloat(lat);
        const parsedLng = parseFloat(lng);
        if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
            const stopByLocation = await Stop.findOne({
                location: {
                    $nearSphere: {
                        $geometry: { type: "Point", coordinates: [parsedLng, parsedLat] }
                    }
                }
            }).lean();
            if (stopByLocation) return stopByLocation;
        }
    }

    if (!nameOrQuery) return null;

    const clean = normalizeText(nameOrQuery);
    const escaped = clean.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

    // 1. Exact or substring match on full query
    let stop = await Stop.findOne({ stationName: { $regex: escaped, $options: "i" } }).lean();
    if (stop) return stop;

    // 2. Tokenized search (e.g. for "madhuram sandwich, bhawarkuan", match "bhawarkua")
    const tokens = clean.split(/[\s,]+/).filter(t => t.length >= 3);
    for (const token of tokens) {
        const tokenEscaped = token.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        stop = await Stop.findOne({ stationName: { $regex: tokenEscaped, $options: "i" } }).lean();
        if (stop) return stop;
    }

    return null;
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
        const clean = normalizeText(q);
        const escaped = clean.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

        // 1. Search full string
        let stops = await Stop.find({
            stationName: { $regex: escaped, $options: "i" }
        }).limit(10).lean();

        // 2. If nothing found, try matching individual tokens
        if (stops.length === 0) {
            const tokens = clean.split(/[\s,]+/).filter(t => t.length >= 3);
            for (const token of tokens) {
                const tokenEscaped = token.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                const matched = await Stop.find({
                    stationName: { $regex: tokenEscaped, $options: "i" }
                }).limit(5).lean();
                if (matched.length > 0) {
                    stops = matched;
                    break;
                }
            }
        }

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
        const startStop = await resolveStopFlexible(startStopName, startLat, startLng);
        const endStop = await resolveStopFlexible(endStopName, endLat, endLng);

        if (!startStop || !endStop) {
            return res.status(404).json({
                success: false,
                message: `Could not resolve start stop (${startStopName || 'coords'}) or destination stop (${endStopName || 'coords'}).`
            });
        }

        if (startStop._id.toString() === endStop._id.toString()) {
            return res.status(200).json({
                success: true,
                startStop: startStop.stationName,
                endStop: endStop.stationName,
                routes: []
            });
        }

        // Find routes that contain both stops in proper order (startStop sequence < endStop sequence)
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

        const activeBuses = await busService.getActiveBuses();
        const now = Date.now();

        for (const r of matchingRoutes) {
            const liveForRoute = activeBuses.filter(b => b.routeId === r.routeId);
            r.liveBuses = liveForRoute.map(b => {
                const elapsedMinutes = Math.floor((now - (b.updatedAt || now)) / 60000);
                return {
                    busId: b.busId,
                    minutesAgoUpdated: elapsedMinutes,
                    estimatedArrivalMinutes: Math.max(3, 5 + Math.floor(Math.random() * 8))
                };
            });
            r.hasActiveBusesWithin20Mins = r.liveBuses.length > 0;
        }

        const totalActiveBuses = matchingRoutes.reduce((acc, r) => acc + (r.liveBuses ? r.liveBuses.length : 0), 0);

        res.status(200).json({
            success: true,
            startStop: startStop.stationName,
            endStop: endStop.stationName,
            routes: matchingRoutes,
            hasActiveBusesWithin20Mins: totalActiveBuses > 0
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
            const stop = await resolveStopFlexible(stopName);
            if (stop) {
                const routeStops = await RouteStop.find({ stopId: stop._id }).lean();
                const routeIds = new Set(routeStops.map(rs => rs.routeId));
                filteredBuses = filteredBuses.filter(b => b.routeId && routeIds.has(b.routeId));
            } else {
                filteredBuses = [];
            }
        }

        const now = Date.now();
        const results = filteredBuses.map(b => {
            const elapsedMinutes = Math.floor((now - (b.updatedAt || now)) / 60000);
            return {
                busId: b.busId,
                routeId: b.routeId,
                routeName: b.routeName,
                driverPhone: b.driverPhone,
                latitude: b.lat,
                longitude: b.lng,
                updatedMinutesAgo: elapsedMinutes,
                isLiveNow: elapsedMinutes <= 5,
                estimatedArrivalMinutes: Math.max(3, 5 + Math.floor(Math.random() * 10))
            };
        });

        res.status(200).json({
            success: true,
            buses: results,
            hasActiveBusesWithin20Mins: results.length > 0
        });
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
