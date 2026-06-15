// models/stopModel.js
const mongoose = require("mongoose");

const StopSchema = new mongoose.Schema({
    stationName: {
        type: String,
        required: true,
        trim: true
    },
    latitude: {
        type: Number,
        required: true
    },
    longitude: {
        type: Number,
        required: true
    },
    location: {
        type: {
            type: String,
            enum: ["Point"],
            default: "Point"
        },
        coordinates: {
            type: [Number], // [Longitude, Latitude] for GeoJSON
            required: true
        }
    }
}, { timestamps: true });

// Add index for $nearSphere queries
StopSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Stop", StopSchema);
