// routes/routeRoutes.js
const express = require("express");
const router = express.Router();
const routeController = require("../controllers/routeController");
const { requireAuth } = require("../middleware/authMiddleware");

// Any authenticated commuter or driver can access these
router.get("/", requireAuth, routeController.getAllRoutes);
router.get("/plan", requireAuth, routeController.planRoute);
router.get("/:routeId/stops", requireAuth, routeController.getRouteStops);

module.exports = router;
