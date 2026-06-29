// scripts/seedRoutes.js
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const Route = require("../models/routeModel");
const RouteStop = require("../models/routeStopModel");
const Stop = require("../models/stopModel");

const routesCsvPath = path.join(__dirname, "..", "..", "client", "resources", "routes.csv");
const routeStopsCsvPath = path.join(__dirname, "..", "..", "client", "resources", "route_stops.csv");
const mongoUri = process.env.MONGODB_ATLAS_URI || process.env.MONGODB_URI;

if (!mongoUri) {
    console.error("Error: MONGODB_ATLAS_URI or MONGODB_URI environment variable is missing in .env file.");
    process.exit(1);
}

// Simple CSV line parser handling optional quotes
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

async function seedDatabase() {
    try {
        console.log("Connecting to MongoDB...");
        await mongoose.connect(mongoUri);
        console.log("Connected successfully.");

        // Fetch all existing stops to map CSV stop names to MongoDB Stop IDs
        console.log("Fetching existing stops from database...");
        const dbStops = await Stop.find({});
        console.log(`Loaded ${dbStops.length} stops from database.`);

        // Build lookup map: stationName -> array of stop objects (since names can duplicate)
        const stopsByName = new Map();
        for (const stop of dbStops) {
            const normName = stop.stationName.trim().toLowerCase();
            if (!stopsByName.has(normName)) {
                stopsByName.set(normName, []);
            }
            stopsByName.get(normName).push(stop);
        }

        // --- 1. Parse routes.csv ---
        console.log(`Reading routes CSV: ${routesCsvPath}`);
        if (!fs.existsSync(routesCsvPath)) {
            throw new Error(`Routes CSV file not found at ${routesCsvPath}`);
        }
        const routesContent = fs.readFileSync(routesCsvPath, "utf-8");
        const routeLines = routesContent.split(/\r?\n/);
        const routesToInsert = [];

        for (let i = 1; i < routeLines.length; i++) {
            const line = routeLines[i].trim();
            if (!line) continue;

            const parts = parseCSVLine(line);
            if (parts.length < 2) {
                console.warn(`Skipping invalid route line ${i + 1}: ${line}`);
                continue;
            }

            const routeId = parseInt(parts[0], 10);
            const routeName = parts[1];

            if (isNaN(routeId)) {
                console.warn(`Skipping route line ${i + 1} due to invalid RouteId: ${line}`);
                continue;
            }

            routesToInsert.push({ routeId, routeName });
        }
        console.log(`Parsed ${routesToInsert.length} routes.`);

        // --- 2. Parse route_stops.csv ---
        console.log(`Reading route stops CSV: ${routeStopsCsvPath}`);
        if (!fs.existsSync(routeStopsCsvPath)) {
            throw new Error(`Route stops CSV file not found at ${routeStopsCsvPath}`);
        }
        const routeStopsContent = fs.readFileSync(routeStopsCsvPath, "utf-8");
        const routeStopsLines = routeStopsContent.split(/\r?\n/);
        const routeStopsToInsert = [];

        let matchCount = 0;
        let fallbackProximityCount = 0;
        let unmappedCount = 0;

        for (let i = 1; i < routeStopsLines.length; i++) {
            const line = routeStopsLines[i].trim();
            if (!line) continue;

            const parts = parseCSVLine(line);
            if (parts.length < 6) {
                console.warn(`Skipping invalid route_stops line ${i + 1}: ${line}`);
                continue;
            }

            const routeId = parseInt(parts[0], 10);
            const stopSequence = parseInt(parts[2], 10);
            const stopName = parts[3];
            const lat = parseFloat(parts[4]);
            const lon = parseFloat(parts[5]);

            if (isNaN(routeId) || isNaN(stopSequence) || isNaN(lat) || isNaN(lon)) {
                console.warn(`Skipping route_stops line ${i + 1} due to invalid numeric fields: ${line}`);
                continue;
            }

            // Resolve stop using name and proximity matching
            const normName = stopName.trim().toLowerCase();
            const candidates = stopsByName.get(normName) || [];
            let matchedStop = null;

            if (candidates.length === 1) {
                // Perfect unique name match
                matchedStop = candidates[0];
                matchCount++;
            } else if (candidates.length > 1) {
                // Name matches multiple stops, pick the closest one geographically
                let minDistance = Infinity;
                for (const candidate of candidates) {
                    const dist = Math.hypot(candidate.latitude - lat, candidate.longitude - lon);
                    if (dist < minDistance) {
                        minDistance = dist;
                        matchedStop = candidate;
                    }
                }
                matchCount++;
            } else {
                // No exact name match. Let's find the closest stop overall in the DB
                let minDistance = Infinity;
                for (const stop of dbStops) {
                    const dist = Math.hypot(stop.latitude - lat, stop.longitude - lon);
                    if (dist < minDistance) {
                        minDistance = dist;
                        matchedStop = stop;
                    }
                }

                if (matchedStop) {
                    // Check if the closest stop is within ~1km (0.01 degrees)
                    if (minDistance > 0.01) {
                        console.warn(`Warning: resolved stop "${stopName}" to nearest "${matchedStop.stationName}" but distance is large (${minDistance.toFixed(5)} deg)`);
                    }
                    fallbackProximityCount++;
                } else {
                    console.error(`Error: Could not resolve stop "${stopName}" at (${lat}, ${lon}) to any stop in DB.`);
                    unmappedCount++;
                    continue;
                }
            }

            routeStopsToInsert.push({
                routeId,
                stopId: matchedStop._id,
                stopName: matchedStop.stationName,
                latitude: matchedStop.latitude,
                longitude: matchedStop.longitude,
                stopSequence
            });
        }

        console.log(`Parsed ${routeStopsToInsert.length} route stops.`);
        console.log(`- Exact name matches: ${matchCount}`);
        console.log(`- Fallback coordinate matches: ${fallbackProximityCount}`);
        if (unmappedCount > 0) {
            console.warn(`- Failed to map: ${unmappedCount}`);
        }

        // --- 3. Save to DB ---
        console.log("Clearing existing Route collection...");
        await Route.deleteMany({});
        console.log("Clearing existing RouteStop collection...");
        await RouteStop.deleteMany({});

        console.log("Inserting routes...");
        const routesResult = await Route.insertMany(routesToInsert);
        console.log(`Successfully seeded ${routesResult.length} routes.`);

        console.log("Inserting route stops...");
        const routeStopsResult = await RouteStop.insertMany(routeStopsToInsert);
        console.log(`Successfully seeded ${routeStopsResult.length} route stops.`);

    } catch (err) {
        console.error("Seeding error:", err);
    } finally {
        await mongoose.connection.close();
        console.log("MongoDB connection closed.");
    }
}

seedDatabase();
