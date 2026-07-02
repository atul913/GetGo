// routes/supportRoutes.js
const express = require("express");
const router = express.Router();
const supportController = require("../controllers/supportController");
const supportToolsController = require("../controllers/supportToolsController");
const { requireAuth } = require("../middleware/authMiddleware");
const supportAuth = require("../middleware/supportAuth");

// All support requests require user authentication
router.post("/message", requireAuth, supportController.sendMessage);

// n8n AI agent HTTP Request Tool routes (secured by API key middleware)
router.get("/tools/stops/nearest", supportAuth, supportToolsController.getNearestStopsTool);
router.get("/tools/stops/search", supportAuth, supportToolsController.searchStopsTool);
router.get("/tools/routes/stops", supportAuth, supportToolsController.getRouteStopsTool);
router.get("/tools/routes/plan", supportAuth, supportToolsController.planRouteTool);
router.get("/tools/buses/live", supportAuth, supportToolsController.getLiveBusesTool);

module.exports = router;
