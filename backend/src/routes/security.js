// Security alerts API — staff review feed for the anti-tailgating pack.
// Alerts are created silently by the check-in paths (anti-passback blocks)
// and the UniFi integration (camera person-count mismatches); this router
// only reads them back and acknowledges them.
const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requirePermission } = require('../middleware/auth');

// GET /api/security/alerts — open alerts first, then newest. ?status=all
// includes acknowledged ones (default: last 50 either way).
router.get('/alerts', authenticate, requirePermission('visits'), async (req, res) => {
  try {
    const r = await db.query(
      `SELECT a.id, a.type, a.message, a.metadata, a.acknowledged_at, a.created_at,
              u.first_name AS ack_first_name, u.last_name AS ack_last_name
       FROM security_alerts a
       LEFT JOIN users u ON u.id = a.acknowledged_by
       WHERE a.org_id = $1
       ORDER BY (a.acknowledged_at IS NULL) DESC, a.created_at DESC
       LIMIT 50`,
      [req.user.org_id]
    );
    res.json(r.rows);
  } catch (e) {
    if (e.code === '42P01') {
      return res.status(500).json({ error: 'Security alerts table missing — run migration-security-groups.txt in Render PSQL first' });
    }
    console.error(e);
    res.status(500).json({ error: 'Failed to load security alerts' });
  }
});

// PATCH /api/security/alerts/:id/acknowledge — mark reviewed (kept in the log)
router.patch('/alerts/:id/acknowledge', authenticate, requirePermission('visits'), async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE security_alerts SET acknowledged_at = NOW(), acknowledged_by = $1
       WHERE id = $2 AND org_id = $3 AND acknowledged_at IS NULL RETURNING id`,
      [req.user.id, req.params.id, req.user.org_id]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Alert not found or already acknowledged' });
    }
    res.json({ success: true });
  } catch (e) {
    if (e.code === '42P01') {
      return res.status(500).json({ error: 'Security alerts table missing — run migration-security-groups.txt in Render PSQL first' });
    }
    console.error(e);
    res.status(500).json({ error: 'Failed to acknowledge alert' });
  }
});

module.exports = router;
