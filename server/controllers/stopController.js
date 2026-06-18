// controllers/stopController.js
const Stop = require("../models/stopModel");

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

module.exports = { getNearestStops, getAllStops, searchStops };
