const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
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
    let result;
    try {
      result = await db.query(`
        UPDATE organizations
        SET plan = COALESCE($1, plan), status = COALESCE($2, status),
            billing_email = COALESCE($3, billing_email), max_users = COALESCE($4, max_users),
            max_visits_per_month = COALESCE($5, max_visits_per_month), updated_at = NOW()
        WHERE id = $6 RETURNING *
      `, [plan, status, billing_email, max_users, max_visits_per_month, req.params.id]);
    } catch (e) {
      if (e.code !== '42703') throw e; // no updated_at column on this schema — retry without it
      result = await db.query(`
        UPDATE organizations
        SET plan = COALESCE($1, plan), status = COALESCE($2, status),
            billing_email = COALESCE($3, billing_email), max_users = COALESCE($4, max_users),
            max_visits_per_month = COALESCE($5, max_visits_per_month)
        WHERE id = $6 RETURNING *
      `, [plan, status, billing_email, max_users, max_visits_per_month, req.params.id]);
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

// GET single organization with users, hosts, devices and usage (super admin only)
router.get('/organizations/:id', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const orgResult = await db.query('SELECT * FROM organizations WHERE id = $1', [req.params.id]);
    if (orgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Each section is independent — if one query fails (e.g. an older database
    // missing a column or table), the rest of the modal still loads.
    let users = [], hosts = [], usage = null;
    const sectionErrors = {};

    try {
      const usersResult = await db.query(
        'SELECT id, email, first_name, last_name, role, is_active FROM users WHERE org_id = $1 ORDER BY first_name, last_name',
        [req.params.id]
      );
      users = usersResult.rows;
    } catch (e) { console.error('superAdmin detail: users query failed:', e.message); sectionErrors.users = e.message; }

    try {
      const hostsResult = await db.query(
        'SELECT id, first_name, last_name, email, department, is_active FROM hosts WHERE org_id = $1 ORDER BY last_name, first_name LIMIT 200',
        [req.params.id]
      );
      hosts = hostsResult.rows;
    } catch (e) { console.error('superAdmin detail: hosts query failed:', e.message); sectionErrors.hosts = e.message; }

    try {
      const usageResult = await db.query(
        `SELECT
           (SELECT COUNT(*) FROM visits WHERE org_id = $1) as total_visits,
           (SELECT COUNT(*) FROM visits WHERE org_id = $1 AND status = 'checked_in') as active_visits,
           (SELECT COUNT(*) FROM visits WHERE org_id = $1 AND checked_in_at >= DATE_TRUNC('month', CURRENT_DATE)) as visits_this_month,
           (SELECT COUNT(*) FROM pre_registered_visitors WHERE org_id = $1) as pre_regs,
           (SELECT COUNT(*) FROM devices WHERE org_id = $1 AND is_active = true) as devices`,
        [req.params.id]
      );
      usage = usageResult.rows[0];
    } catch (e) { console.error('superAdmin detail: usage query failed:', e.message); sectionErrors.usage = e.message; }

    res.json({
      organization: orgResult.rows[0],
      users,
      hosts,
      usage,
      ...(Object.keys(sectionErrors).length > 0 ? { section_errors: sectionErrors } : {}),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch organization details' });
  }
});

// POST reset a user's password — generates a temporary password (super admin only)
router.post('/users/:userId/reset-password', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const userResult = await db.query('SELECT id, email, first_name FROM users WHERE id = $1', [req.params.userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Readable temporary password, shown once to the admin
    const tempPassword = 'Ksk-' + crypto.randomBytes(4).toString('hex');
    const hashed = await bcrypt.hash(tempPassword, 10);

    // must_change_password only exists after the invites migration — try with, fall back without
    try {
      await db.query('UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2', [hashed, req.params.userId]);
    } catch (e) {
      if (e.code !== '42703') throw e;
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashed, req.params.userId]);
    }

    res.json({ success: true, temp_password: tempPassword, user_email: userResult.rows[0].email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// POST change a user's login email (super admin only) — e.g. when the org's admin
// leaves the company and access must move to their replacement
router.post('/users/:userId/change-email', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }
    const dup = await db.query('SELECT id FROM users WHERE LOWER(email) = $1 AND id != $2', [email, req.params.userId]);
    if (dup.rows.length > 0) {
      return res.status(400).json({ error: 'That email is already in use' });
    }
    const result = await db.query(
      'UPDATE users SET email = $1 WHERE id = $2 RETURNING id, email, first_name, last_name',
      [email, req.params.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to change email' });
  }
});

// POST create a tech-support admin inside a customer organization (super admin only).
// Gives Sentinels staff a login to troubleshoot that org — useful for enterprise tiers.
router.post('/organizations/:id/support-admin', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const { email, first_name = 'Sentinels', last_name = 'Support' } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }
    const orgResult = await db.query('SELECT id, name FROM organizations WHERE id = $1', [req.params.id]);
    if (orgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    const dup = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [cleanEmail]);
    if (dup.rows.length > 0) {
      return res.status(400).json({ error: 'A user with that email already exists' });
    }

    const tempPassword = 'Ksk-' + crypto.randomBytes(4).toString('hex');
    const hashed = await bcrypt.hash(tempPassword, 10);
    let newUser;
    try {
      const r = await db.query(
        `INSERT INTO users (org_id, email, password_hash, first_name, last_name, role, must_change_password)
         VALUES ($1, $2, $3, $4, $5, 'admin', true) RETURNING id, email, role`,
        [req.params.id, cleanEmail, hashed, first_name, last_name]
      );
      newUser = r.rows[0];
    } catch (e) {
      if (e.code !== '42703') throw e;
      const r = await db.query(
        `INSERT INTO users (org_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, $4, $5, 'admin') RETURNING id, email, role`,
        [req.params.id, cleanEmail, hashed, first_name, last_name]
      );
      newUser = r.rows[0];
    }

    res.json({ success: true, temp_password: tempPassword, user: newUser, org_name: orgResult.rows[0].name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create support admin' });
  }
});

// ---- Tech Support Access: assign EXISTING users from your own org to support a customer org ----
// Assigned users get an org switcher in their sidebar and can jump into the customer org
// with full access to troubleshoot. Tracked in the support_assignments table.

// GET active users from the super admin's OWN organization (the picker list)
router.get('/support-candidates', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const homeOrg = req.user.home_org_id || req.user.org_id;
    const result = await db.query(
      `SELECT id, first_name, last_name, email, role FROM users
       WHERE org_id = $1 AND is_active = true ORDER BY first_name, last_name`,
      [homeOrg]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch your team members' });
  }
});

// GET current support assignments for a customer org
router.get('/organizations/:id/support-access', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT sa.user_id, u.first_name, u.last_name, u.email, sa.created_at
       FROM support_assignments sa JOIN users u ON u.id = sa.user_id
       WHERE sa.org_id = $1 ORDER BY sa.created_at`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(500).json({ error: 'support_assignments table is missing — run migration-support-roles.txt in Render PSQL' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch support access' });
  }
});

// POST assign one of your existing users as support for a customer org
router.post('/organizations/:id/support-access', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    const homeOrg = req.user.home_org_id || req.user.org_id;

    // Only users from your own organization can be assigned
    const userCheck = await db.query(
      'SELECT id, first_name, last_name, email FROM users WHERE id = $1 AND org_id = $2 AND is_active = true',
      [user_id, homeOrg]
    );
    if (userCheck.rows.length === 0) {
      return res.status(400).json({ error: 'That user is not an active member of your organization' });
    }
    if (user_id === req.user.id) {
      return res.status(400).json({ error: 'You are already a super admin — you can switch into any organization without an assignment' });
    }
    const orgCheck = await db.query('SELECT id, name FROM organizations WHERE id = $1', [req.params.id]);
    if (orgCheck.rows.length === 0) return res.status(404).json({ error: 'Organization not found' });
    if (req.params.id === homeOrg) {
      return res.status(400).json({ error: 'This user already belongs to that organization' });
    }

    await db.query(
      'INSERT INTO support_assignments (user_id, org_id) VALUES ($1, $2) ON CONFLICT (user_id, org_id) DO NOTHING',
      [user_id, req.params.id]
    );
    res.json({ success: true, user: userCheck.rows[0], org_name: orgCheck.rows[0].name });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(500).json({ error: 'support_assignments table is missing — run migration-support-roles.txt in Render PSQL' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to assign support access' });
  }
});

// DELETE revoke a user's support access to a customer org
router.delete('/organizations/:id/support-access/:userId', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    await db.query('DELETE FROM support_assignments WHERE org_id = $1 AND user_id = $2', [req.params.id, req.params.userId]);
    res.json({ success: true });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(500).json({ error: 'support_assignments table is missing — run migration-support-roles.txt in Render PSQL' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to revoke support access' });
  }
});

// DELETE an organization and ALL its data (super admin only).
// Finds every table with an org_id column and removes the child rows first,
// so it works even as the schema grows. Cannot delete your own organization.
router.delete('/organizations/:id', authenticate, requireRole('super_admin'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    const homeOrg = req.user.home_org_id || req.user.org_id;
    if (req.params.id === homeOrg) {
      return res.status(400).json({ error: 'You cannot delete your own organization' });
    }
    const orgResult = await db.query('SELECT id, name FROM organizations WHERE id = $1', [req.params.id]);
    if (orgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Every table that references the org — discovered dynamically
    const tablesResult = await db.query(
      `SELECT table_name FROM information_schema.columns
       WHERE column_name = 'org_id' AND table_schema = 'public' AND table_name != 'organizations'`
    );
    const childTables = tablesResult.rows
      .map(r => r.table_name)
      .filter(n => /^[a-z_][a-z0-9_]*$/.test(n));

    await client.query('BEGIN');
    for (const table of childTables) {
      await client.query(`DELETE FROM "${table}" WHERE org_id = $1`, [req.params.id]);
    }
    await client.query('DELETE FROM organizations WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');

    res.json({ success: true, deleted: orgResult.rows[0].name, tables_cleaned: childTables.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: `Could not delete organization: ${err.message}` });
  } finally {
    client.release();
  }
});

// PATCH deactivate/reactivate any user in any org (super admin only)
router.patch('/users/:userId/status', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const { is_active } = req.body;
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active (boolean) is required' });
    }
    if (req.params.userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }
    const r = await db.query(
      'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, email, is_active',
      [is_active, req.params.userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// GET every user across all orgs (super admin only) — verifies the "Total Users" number
router.get('/all-users', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.is_active, o.name as org_name
       FROM users u JOIN organizations o ON o.id = u.org_id
       ORDER BY o.name, u.last_name LIMIT 500`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET recent visits across all orgs (super admin only) — verifies the visits numbers
router.get('/recent-visits', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT v.id, v.visitor_first_name, v.visitor_last_name, v.badge_number, v.status,
              v.checked_in_at, o.name as org_name
       FROM visits v JOIN organizations o ON o.id = v.org_id
       ORDER BY v.checked_in_at DESC LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch visits' });
  }
});

module.exports = router;
