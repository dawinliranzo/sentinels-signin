const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/settings — this organization's settings (any logged-in user)
router.get('/', authenticate, async (req, res) => {
  try {
    const r = await db.query('SELECT settings FROM organizations WHERE id = $1', [req.user.org_id]);
    res.json(r.rows[0]?.settings || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load settings', details: err.message });
  }
});

// PATCH /api/settings — replace this organization's settings (admins only)
router.patch('/', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const r = await db.query(
      'UPDATE organizations SET settings = $1 WHERE id = $2 RETURNING settings',
      [JSON.stringify(req.body || {}), req.user.org_id]
    );
    res.json(r.rows[0].settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save settings', details: err.message });
  }
});

module.exports = router;
