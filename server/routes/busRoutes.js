// routes/busRoutes.js
const express = require("express");
const router = express.Router();
const busController = require("../controllers/busController");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");

// Driver-only routes
router.post("/start", requireAuth, requireRole("driver"), busController.startTrip);
router.post("/location", requireAuth, requireRole("driver"), busController.updateLocation);
router.post("/update", requireAuth, requireRole("driver"), busController.updateLocation);
router.post("/end", requireAuth, requireRole("driver"), busController.endTrip);

// Available to any logged-in user (commuter or driver)
router.get("/all", requireAuth, busController.getAllBuses);
router.get("/active", requireAuth, busController.getAllBuses);

module.exports = router;