const express = require("express");
const router = express.Router();
const db = require("../utils/db");
const { authenticate } = require("../middleware/auth");

router.get("/", authenticate, async (req, res) => {
  const result = await db.query("SELECT * FROM visitor_types WHERE org_id = $1 AND is_active = true ORDER BY sort_order", [req.user.org_id]);
  res.json(result.rows);
});

module.exports = router;