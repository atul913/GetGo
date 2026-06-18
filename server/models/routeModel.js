// models/routeModel.js
const mongoose = require("mongoose");

const RouteSchema = new mongoose.Schema({
    routeId: {
        type: Number,
        required: true,
        unique: true
    },
    routeName: {
        type: String,
        required: true,
        trim: true
    }
}, { timestamps: true });

module.exports = mongoose.model("Route", RouteSchema);
