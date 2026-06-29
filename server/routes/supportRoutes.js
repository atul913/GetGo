// routes/supportRoutes.js
const express = require("express");
const router = express.Router();
const supportController = require("../controllers/supportController");
const { requireAuth } = require("../middleware/authMiddleware");

// All support requests require user authentication
router.post("/message", requireAuth, supportController.sendMessage);

module.exports = router;
