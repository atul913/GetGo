// services/busService.js
const redisClient = require("./redisClient");
const Route = require("../models/routeModel");

// Default TTL: if a driver doesn't send location coordinates for 60 seconds (customizable),
// they are considered offline and the trip will automatically expire.
const TRIP_EXPIRY_SECONDS = parseInt(process.env.TRIP_TTL_SECONDS) || 60;

/**
 * Start a trip for a given busId.
 * Overwrites any previous trip data for this busId.
 */
const startTrip = async (busId, driverPhone, routeId) => {
    const now = Date.now();
    let routeName = null;

    if (routeId) {
        try {
            const route = await Route.findOne({ routeId: parseInt(routeId, 10) });
            if (route) {
                routeName = route.routeName;
            }
        } catch (err) {
            console.error("Error resolving route in busService:", err.message);
        }
    }

    const bus = {
        busId,
        driverPhone,
        status: "active",
        lat: null,
        lng: null,
        startedAt: now,
        updatedAt: now,
        endedAt: null,
        routeId: routeId ? parseInt(routeId, 10) : null,
        routeName: routeName
    };
    
    // Save the bus object in Redis with expiration
    await redisClient.set(`bus:trip:${busId}`, JSON.stringify(bus), { EX: TRIP_EXPIRY_SECONDS });
    // Add to active buses set
    await redisClient.sAdd("active_buses", busId);
    
    return bus;
};

/**
 * Update GPS coordinates for an active bus.
 * Returns null if the bus has no active trip.
 */
const updateLocation = async (busId, lat, lng) => {
    const busData = await redisClient.get(`bus:trip:${busId}`);
    if (!busData) {
        return null;
    }
    
    const bus = JSON.parse(busData);
    if (bus.status !== "active") {
        return null;
    }
    
    bus.lat = lat;
    bus.lng = lng;
    bus.updatedAt = Date.now();
    
    // Update data and refresh expiration TTL
    await redisClient.set(`bus:trip:${busId}`, JSON.stringify(bus), { EX: TRIP_EXPIRY_SECONDS });
    return bus;
};

/**
 * End a trip for a given busId.
 */
const endTrip = async (busId) => {
    const busData = await redisClient.get(`bus:trip:${busId}`);
    if (!busData) {
        // Even if expired, clean up active set
        await redisClient.sRem("active_buses", busId);
        return null;
    }
    
    const bus = JSON.parse(busData);
    bus.status = "ended";
    bus.endedAt = Date.now();
    bus.updatedAt = Date.now();
    
    // Delete the active trip key
    await redisClient.del(`bus:trip:${busId}`);
    // Remove from active buses set
    await redisClient.sRem("active_buses", busId);
    
    return bus;
};

/**
 * Get all currently active buses (for the commuter dashboard).
 */
const getActiveBuses = async () => {
    const activeBusIds = await redisClient.sMembers("active_buses");
    const activeBuses = [];
    
    for (const busId of activeBusIds) {
        const busData = await redisClient.get(`bus:trip:${busId}`);
        if (busData) {
            const bus = JSON.parse(busData);
            if (bus.status === "active" && bus.lat !== null) {
                activeBuses.push(bus);
            }
        } else {
            // Lazy prune: key expired, meaning driver is offline. Remove from set.
            await redisClient.sRem("active_buses", busId);
        }
    }
    
    return activeBuses;
};

/**
 * Get a single bus by ID (any status).
 */
const getBus = async (busId) => {
    const busData = await redisClient.get(`bus:trip:${busId}`);
    return busData ? JSON.parse(busData) : null;
};

module.exports = { startTrip, updateLocation, endTrip, getActiveBuses, getBus };