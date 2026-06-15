// controllers/busController.js
const busService = require("../services/busService");

/**
 * POST /api/bus/start
 * body: { busId }
 * auth: driver
 */
const startTrip = async (req, res) => {
    const { busId } = req.body;

    if (!busId) {
        return res.status(400).json({ success: false, message: "busId is required" });
    }

    try {
        const bus = await busService.startTrip(busId, req.user.phone);
        res.status(200).json({ success: true, bus });
    } catch (error) {
        console.error("startTrip error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * POST /api/bus/location or /api/bus/update
 * body: { busId, lat, lng } or { busId, latitude, longitude }
 * auth: driver
 * Driver polls this every ~5 seconds while a trip is active.
 */
const updateLocation = async (req, res) => {
    const { busId } = req.body;
    const lat = req.body.latitude !== undefined ? req.body.latitude : req.body.lat;
    const lng = req.body.longitude !== undefined ? req.body.longitude : req.body.lng;

    if (!busId || lat === undefined || lng === undefined) {
        return res.status(400).json({ success: false, message: "busId, lat/latitude and lng/longitude are required" });
    }

    try {
        const bus = await busService.updateLocation(busId, parseFloat(lat), parseFloat(lng));

        if (!bus) {
            return res.status(400).json({ success: false, message: "No active trip found for this busId. Start a trip first." });
        }

        res.status(200).json({ success: true, bus });
    } catch (error) {
        console.error("updateLocation error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * POST /api/bus/end
 * body: { busId }
 * auth: driver
 */
const endTrip = async (req, res) => {
    const { busId } = req.body;

    if (!busId) {
        return res.status(400).json({ success: false, message: "busId is required" });
    }

    try {
        const bus = await busService.endTrip(busId);

        if (!bus) {
            return res.status(404).json({ success: false, message: "Bus not found" });
        }

        res.status(200).json({ success: true, bus });
    } catch (error) {
        console.error("endTrip error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/bus/all or /api/bus/active
 * auth: commuter (or driver)
 * Commuter polls this every ~10 seconds.
 */
const getAllBuses = async (req, res) => {
    try {
        const rawBuses = await busService.getActiveBuses();
        const formattedBuses = rawBuses.map((b) => ({
            busId: b.busId,
            phone: b.driverPhone,
            startTime: b.startedAt,
            coordinates: {
                latitude: b.lat,
                longitude: b.lng
            },
            lastUpdated: b.updatedAt,
            driverPhone: b.driverPhone,
            status: b.status,
            lat: b.lat,
            lng: b.lng,
            startedAt: b.startedAt,
            updatedAt: b.updatedAt
        }));

        res.status(200).json({
            success: true,
            buses: formattedBuses,
            activeBuses: formattedBuses
        });
    } catch (error) {
        console.error("getAllBuses error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { startTrip, updateLocation, endTrip, getAllBuses };