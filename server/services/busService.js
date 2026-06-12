// services/busService.js
const { buses } = require("../models/busModel");

/**
 * Start a trip for a given busId.
 * Overwrites any previous trip data for this busId.
 */
const startTrip = (busId, driverPhone) => {
    const now = Date.now();
    const bus = {
        busId,
        driverPhone,
        status: "active",
        lat: null,
        lng: null,
        startedAt: now,
        updatedAt: now,
        endedAt: null,
    };
    buses.set(busId, bus);
    return bus;
};

/**
 * Update GPS coordinates for an active bus.
 * Returns null if the bus has no active trip.
 */
const updateLocation = (busId, lat, lng) => {
    const bus = buses.get(busId);
    if (!bus || bus.status !== "active") {
        return null;
    }
    bus.lat = lat;
    bus.lng = lng;
    bus.updatedAt = Date.now();
    return bus;
};

/**
 * End a trip for a given busId.
 */
const endTrip = (busId) => {
    const bus = buses.get(busId);
    if (!bus) {
        return null;
    }
    bus.status = "ended";
    bus.endedAt = Date.now();
    bus.updatedAt = Date.now();
    return bus;
};

/**
 * Get all currently active buses (for the commuter dashboard).
 */
const getActiveBuses = () => {
    return Array.from(buses.values()).filter((b) => b.status === "active" && b.lat !== null);
};

/**
 * Get a single bus by ID (any status).
 */
const getBus = (busId) => buses.get(busId) || null;

module.exports = { startTrip, updateLocation, endTrip, getActiveBuses, getBus };