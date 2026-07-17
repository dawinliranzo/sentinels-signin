const express = require("express");
const router = express.Router();
const db = require("../utils/db");
const { authenticate } = require("../middleware/auth");

router.get("/", authenticate, async (req, res) => {
  const result = await db.query("SELECT * FROM documents WHERE org_id = $1 AND is_active = true", [req.user.org_id]);
  res.json(result.rows);
});

module.exports = router;