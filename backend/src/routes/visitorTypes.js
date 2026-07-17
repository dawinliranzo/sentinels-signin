const express = require("express");
const router = express.Router();
const db = require("../utils/db");
const { authenticate } = require("../middleware/auth");

router.get("/", authenticate, async (req, res) => {
  const result = await db.query("SELECT * FROM visitor_types WHERE org_id = $1 AND is_active = true ORDER BY sort_order", [req.user.org_id]);
  res.json(result.rows);
});


// Public endpoint for kiosk - no auth required
router.get('/public/:orgId', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, description, badge_color, requires_nda FROM visitor_types WHERE org_id = $1 AND is_active = true ORDER BY sort_order',
      [req.params.orgId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Public visitor types error:', err);
    res.status(500).json({ error: 'Failed to fetch visitor types' });
  }
});

module.exports = router;
