// models/routeStopModel.js
const mongoose = require("mongoose");

const RouteStopSchema = new mongoose.Schema({
    routeId: {
        type: Number,
        required: true
    },
    stopId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Stop",
        required: true
    },
    stopName: {
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
    stopSequence: {
        type: Number,
        required: true
    }
}, { timestamps: true });

// Indexing routeId and stopSequence together to optimize queries and enforce consistency
RouteStopSchema.index({ routeId: 1, stopSequence: 1 }, { unique: true });

module.exports = mongoose.model("RouteStop", RouteStopSchema);
