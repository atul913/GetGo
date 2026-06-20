// controllers/stopController.js
const Stop = require("../models/stopModel");
const RouteStop = require("../models/routeStopModel");
const Route = require("../models/routeModel");
const busService = require("../services/busService");

const getNearestStops = async (req, res) => {
    const { latitude, longitude } = req.query;

    if (!latitude || !longitude) {
        return res.status(400).json({ success: false, message: "latitude and longitude query parameters are required" });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ success: false, message: "Invalid coordinates provided" });
    }

    try {
        // Query nearest stops using GeoJSON 2dsphere index
        const nearestStops = await Stop.find({
            location: {
                $nearSphere: {
                    $geometry: {
                        type: "Point",
                        coordinates: [lng, lat] // [Longitude, Latitude]
                    }
                }
            }
        }).limit(5);

        res.status(200).json({ success: true, stops: nearestStops });
    } catch (error) {
        console.error("getNearestStops error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAllStops = async (req, res) => {
    try {
        const stops = await Stop.find({}).sort({ stationName: 1 });
        res.status(200).json({ success: true, stops });
    } catch (error) {
        console.error("getAllStops error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

const searchStops = async (req, res) => {
    const { q } = req.query;

    if (!q) {
        return res.status(200).json({ success: true, stops: [] });
    }

    try {
        const query = q.trim();
        const stops = await Stop.find({
            stationName: { $regex: query, $options: "i" }
        }).limit(10);

        res.status(200).json({ success: true, stops });
    } catch (error) {
        console.error("searchStops error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getLiveBusesForStop = async (req, res) => {
    const { stopId } = req.params;

    if (!stopId) {
        return res.status(400).json({ success: false, message: "stopId path parameter is required" });
    }

    try {
        // 1. Get all route-stops containing this stopId
        const routeStops = await RouteStop.find({ stopId });
        const routeIds = routeStops.map(rs => rs.routeId);

        // 2. Get route details for those routeIds
        const routes = await Route.find({ routeId: { $in: routeIds } });
        const routeMap = new Map();
        routes.forEach(r => {
            routeMap.set(r.routeId, r);
        });

        // 3. Get all active buses
        const activeBuses = await busService.getActiveBuses();

        // 4. Filter active buses that pass through this stop
        const matchingBuses = [];
        for (const bus of activeBuses) {
            let isMatch = false;
            let matchedRouteName = "";

            // Fallback / legacy busId matching logic:
            // Extract prefix of busId, e.g. "M-22" from "M-22" or "M-22-LIVE"
            const busIdClean = bus.busId.split(" ")[0].replace(/[:-]+$/, "").toLowerCase();

            // If the bus has routeId saved
            if (bus.routeId && routeIds.includes(bus.routeId)) {
                isMatch = true;
                matchedRouteName = routeMap.get(bus.routeId)?.routeName || `Route ${bus.routeId}`;
            } else {
                // Match by name/code fallback
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
                matchingBuses.push({
                    busId: bus.busId,
                    driverPhone: bus.driverPhone,
                    lat: bus.lat,
                    lng: bus.lng,
                    routeName: matchedRouteName,
                    startTime: bus.startedAt,
                    lastUpdated: bus.updatedAt,
                    routeId: bus.routeId
                });
            }
        }

        res.status(200).json({ success: true, buses: matchingBuses });
    } catch (error) {
        console.error("getLiveBusesForStop error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getNearestStops, getAllStops, searchStops, getLiveBusesForStop };
