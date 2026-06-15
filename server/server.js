// server.js
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");

const mongoose = require("mongoose");

const authRoutes = require("./routes/authRoutes");
const busRoutes = require("./routes/busRoutes");
const stopRoutes = require("./routes/stopRoutes");

// Connect to MongoDB
const mongoUri = process.env.MONGODB_URI;
if (mongoUri) {
    mongoose.connect(mongoUri)
        .then(() => console.log("Connected to MongoDB successfully"))
        .catch(err => {
            console.error("Failed to connect to MongoDB:", err.message);
            console.warn("Continuing server execution without database connection.");
        });
} else {
    console.warn("MONGODB_URI environment variable is missing. Continuing without MongoDB connection.");
}

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/bus", busRoutes);
app.use("/api/stops", stopRoutes);

// Serve the client folder as static files (so you can open everything from one server)
app.use(express.static(path.join(__dirname, "..", "client")));

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`MOCK_OTP=${process.env.MOCK_OTP === "true" ? "ON (use 1234 as OTP)" : "OFF (real SMS)"}`);
});