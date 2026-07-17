const express = require("express");
const router = express.Router();
const db = require("../utils/db");
const { authenticate } = require("../middleware/auth");

router.get("/", authenticate, async (req, res) => {
  const result = await db.query("SELECT * FROM evacuations WHERE org_id = $1 ORDER BY started_at DESC", [req.user.org_id]);
  res.json(result.rows);
});

module.exports = router;