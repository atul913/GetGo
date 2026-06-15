// models/userModel.js
const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
    phone: {
        type: String,
        required: true,
        trim: true
    },
    role: {
        type: String,
        required: true,
        enum: ["driver", "commuter"]
    },
    name: {
        type: String,
        default: ""
    },
    email: {
        type: String,
        default: ""
    },
    age: {
        type: Number,
        default: null
    },
    gender: {
        type: String,
        default: ""
    },
    profileImageUrl: {
        type: String,
        default: ""
    }
}, { timestamps: true });

UserSchema.index({ phone: 1, role: 1 }, { unique: true });

module.exports = mongoose.model("User", UserSchema);
