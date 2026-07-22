const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requirePermission } = require('../middleware/auth');

router.use(authenticate, requirePermission('reports'));

// GET /api/reports/visitor-frequency?from&to
// Visits per day in range, split visitors vs staff badge-ins
router.get('/visitor-frequency', async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 864e5);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const r = await db.query(
      `SELECT DATE(checked_in_at) as day,
              COUNT(*) FILTER (WHERE sign_in_method = 'staff_qr') as staff,
              COUNT(*) FILTER (WHERE sign_in_method != 'staff_qr' OR sign_in_method IS NULL) as visitors,
              COUNT(*) as total
       FROM visits
       WHERE org_id = $1 AND checked_in_at >= $2 AND checked_in_at <= $3
       GROUP BY DATE(checked_in_at)
       ORDER BY day`,
      [req.user.org_id, from.toISOString(), to.toISOString()]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to build visitor frequency report' });
  }
});

// GET /api/reports/daily-attendance?from&to
// Every staff badge sign-in with in/out times and hours on site
router.get('/daily-attendance', async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 864e5);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const r = await db.query(
      `SELECT visitor_first_name, visitor_last_name, visitor_email,
              DATE(checked_in_at) as day,
              checked_in_at, checked_out_at,
              CASE WHEN checked_out_at IS NOT NULL
                   THEN ROUND(EXTRACT(EPOCH FROM (checked_out_at - checked_in_at)) / 3600.0, 2)
                   ELSE NULL END as hours_on_site
       FROM visits
       WHERE org_id = $1 AND sign_in_method = 'staff_qr'
         AND checked_in_at >= $2 AND checked_in_at <= $3
       ORDER BY checked_in_at DESC
       LIMIT 1000`,
      [req.user.org_id, from.toISOString(), to.toISOString()]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to build attendance report' });
  }
});

// GET /api/reports/inactive-hosts?days=7
// Hosts/tenants who have NOT badged in during the last N days
router.get('/inactive-hosts', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 365);
    const r = await db.query(
      `SELECT h.id, h.first_name, h.last_name, h.email, h.department,
              (SELECT MAX(v.checked_in_at) FROM visits v
               WHERE v.org_id = h.org_id AND LOWER(v.visitor_email) = LOWER(h.email)
                 AND v.sign_in_method = 'staff_qr') as last_sign_in
       FROM hosts h
       WHERE h.org_id = $1 AND h.is_active = true
         AND NOT EXISTS (
           SELECT 1 FROM visits v
           WHERE v.org_id = h.org_id AND LOWER(v.visitor_email) = LOWER(h.email)
             AND v.sign_in_method = 'staff_qr'
             AND v.checked_in_at >= NOW() - ($2 || ' days')::interval
         )
       ORDER BY last_sign_in NULLS FIRST, h.last_name`,
      [req.user.org_id, days]
    );
    res.json({ days, hosts: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to build inactive hosts report' });
  }
});

module.exports = router;
