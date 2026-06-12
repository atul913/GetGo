// server.js
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const busRoutes = require("./routes/busRoutes");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/bus", busRoutes);

// Serve the client folder as static files (so you can open everything from one server)
app.use(express.static(path.join(__dirname, "..", "client")));

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`MOCK_OTP=${process.env.MOCK_OTP === "true" ? "ON (use 1234 as OTP)" : "OFF (real SMS)"}`);
});