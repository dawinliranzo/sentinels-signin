const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate } = require('../middleware/auth');

router.get('/stats', authenticate, async (req, res) => {
  try {
    const orgId = req.user.org_id;

    // Active visitors count
    const activeResult = await db.query(
      'SELECT COUNT(*) as count FROM visits WHERE org_id = $1 AND status = \'checked_in\'',
      [orgId]
    );

    // Today's visits
    const todayResult = await db.query(
      'SELECT COUNT(*) as count FROM visits WHERE org_id = $1 AND DATE(checked_in_at) = CURRENT_DATE',
      [orgId]
    );

    // Weekly visits
    const weeklyResult = await db.query(
      `SELECT COUNT(*) as count FROM visits WHERE org_id = $1 AND checked_in_at >= NOW() - INTERVAL '7 days'`,
      [orgId]
    );

    // Active hosts (hosts with visitors today)
    const activeHostsResult = await db.query(
      `SELECT COUNT(DISTINCT host_id) as count FROM visits WHERE org_id = $1 AND status = 'checked_in'`,
      [orgId]
    );

    // Recent visits (last 10)
    const recentResult = await db.query(
      `SELECT v.*, h.first_name as host_first_name, h.last_name as host_last_name
       FROM visits v
       LEFT JOIN hosts h ON v.host_id = h.id
       WHERE v.org_id = $1
       ORDER BY v.checked_in_at DESC LIMIT 10`,
      [orgId]
    );

    // Hourly breakdown for today
    const hourlyResult = await db.query(
      `SELECT EXTRACT(HOUR FROM checked_in_at) as hour, COUNT(*) as count
       FROM visits WHERE org_id = $1 AND DATE(checked_in_at) = CURRENT_DATE
       GROUP BY hour ORDER BY hour`,
      [orgId]
    );

    res.json({
      active_visitors: parseInt(activeResult.rows[0].count),
      today_visits: parseInt(todayResult.rows[0].count),
      weekly_visits: parseInt(weeklyResult.rows[0].count),
      active_hosts: parseInt(activeHostsResult.rows[0].count),
      recent_visits: recentResult.rows,
      hourly_breakdown: hourlyResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

module.exports = router;
