// models/busModel.js

/**
 * Bus / trip data shape (in-memory):
 * {
 *   busId: string,
 *   driverPhone: string,
 *   status: "active" | "ended",
 *   lat: number | null,
 *   lng: number | null,
 *   startedAt: number (timestamp ms),
 *   updatedAt: number (timestamp ms),
 *   endedAt: number | null
 * }
 *
 * Stored in-memory as a Map keyed by busId.
 * Replace with a real DB collection/table later if needed.
 */

const buses = new Map();

module.exports = { buses };