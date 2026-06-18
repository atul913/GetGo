// routes/stopRoutes.js
const express = require("express");
const router = express.Router();
const stopController = require("../controllers/stopController");
const { requireAuth } = require("../middleware/authMiddleware");

// Any authenticated commuter or driver can access these
router.get("/nearest", requireAuth, stopController.getNearestStops);
router.get("/search", requireAuth, stopController.searchStops);
router.get("/", requireAuth, stopController.getAllStops);

module.exports = router;
