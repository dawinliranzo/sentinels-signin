const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET all organizations (super admin only)
router.get('/organizations', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT o.*, 
        (SELECT COUNT(*) FROM users WHERE org_id = o.id) as users_count,
        (SELECT COUNT(*) FROM visits WHERE org_id = o.id AND DATE(checked_in_at) >= DATE_TRUNC('month', CURRENT_DATE)) as visits_this_month
      FROM organizations o
      ORDER BY o.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// GET super admin stats
router.get('/stats', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const orgsResult = await db.query('SELECT COUNT(*) as count FROM organizations');
    const usersResult = await db.query('SELECT COUNT(*) as count FROM users');
    const visitsResult = await db.query('SELECT COUNT(*) as count FROM visits');
    const activeResult = await db.query("SELECT COUNT(*) as count FROM visits WHERE status = 'checked_in'");
    const revenueResult = await db.query("SELECT SUM(CASE WHEN plan = 'pro' THEN 49 WHEN plan = 'enterprise' THEN 149 ELSE 0 END) as mrr FROM organizations");

    res.json({
      total_orgs: parseInt(orgsResult.rows[0].count),
      total_users: parseInt(usersResult.rows[0].count),
      total_visits: parseInt(visitsResult.rows[0].count),
      active_visits: parseInt(activeResult.rows[0].count),
      revenue: parseInt(revenueResult.rows[0].mrr) || 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// PATCH organization (update plan, status)
router.patch('/organizations/:id', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const { plan, status, billing_email, max_users, max_visits_per_month } = req.body;
    const result = await db.query(`
      UPDATE organizations 
      SET plan = COALESCE($1, plan), status = COALESCE($2, status), 
          billing_email = COALESCE($3, billing_email), max_users = COALESCE($4, max_users),
          max_visits_per_month = COALESCE($5, max_visits_per_month), updated_at = NOW()
      WHERE id = $6 RETURNING *
    `, [plan, status, billing_email, max_users, max_visits_per_month, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

module.exports = router;
