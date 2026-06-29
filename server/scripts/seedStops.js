// scripts/seedStops.js
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const Stop = require("../models/stopModel");

const csvPath = path.join(__dirname, "..", "..", "client", "resources", "aictsl_stops.csv");
const mongoUri = process.env.MONGODB_ATLAS_URI || process.env.MONGODB_URI;

if (!mongoUri) {
    console.error("Error: MONGODB_ATLAS_URI or MONGODB_URI environment variable is missing in .env file.");
    process.exit(1);
}

async function seedDatabase() {
    try {
        console.log("Connecting to MongoDB...");
        await mongoose.connect(mongoUri);
        console.log("Connected successfully.");

        if (!fs.existsSync(csvPath)) {
            console.error(`Error: CSV file not found at ${csvPath}`);
            process.exit(1);
        }

        console.log("Reading CSV file...");
        const csvContent = fs.readFileSync(csvPath, "utf-8");
        const lines = csvContent.split(/\r?\n/);

        // Skip header line (StationName,Latitude,Longitude)
        const header = lines[0];
        console.log(`CSV Header: ${header}`);

        const stopsToInsert = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const parts = line.split(",");
            if (parts.length < 3) {
                console.warn(`Skipping invalid line ${i + 1}: ${line}`);
                continue;
            }

            const lngStr = parts.pop();
            const latStr = parts.pop();
            const stationName = parts.join(",").trim();

            const latitude = parseFloat(latStr);
            const longitude = parseFloat(lngStr);

            if (isNaN(latitude) || isNaN(longitude)) {
                console.warn(`Skipping line ${i + 1} due to invalid coordinates: ${line}`);
                continue;
            }

            stopsToInsert.push({
                stationName,
                latitude,
                longitude,
                location: {
                    type: "Point",
                    coordinates: [longitude, latitude] // [lng, lat] for GeoJSON
                }
            });
        }

        console.log(`Parsed ${stopsToInsert.length} stops. Clearing existing collection...`);
        await Stop.deleteMany({});
        console.log("Existing stops cleared.");

        console.log("Inserting new stops...");
        const result = await Stop.insertMany(stopsToInsert);
        console.log(`Successfully seeded ${result.length} bus stops in MongoDB.`);

    } catch (err) {
        console.error("Seeding error:", err);
    } finally {
        await mongoose.connection.close();
        console.log("MongoDB connection closed.");
    }
}

seedDatabase();
