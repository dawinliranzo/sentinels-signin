const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requirePermission, ALL_PERMISSIONS } = require('../middleware/auth');

router.use(authenticate, requirePermission('team'));

// GET /api/roles — this org's custom roles
router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT o.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = o.id) as member_count
       FROM org_roles o WHERE o.org_id = $1 ORDER BY o.name`,
      [req.user.org_id]
    );
    res.json(r.rows);
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(500).json({ error: 'Custom roles table missing — run the latest migration in Render PSQL (migration-support-roles.txt)' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to load roles' });
  }
});

// POST /api/roles — create { name, permissions: [] }
router.post('/', async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const permissions = Array.isArray(req.body.permissions) ? req.body.permissions.filter(p => ALL_PERMISSIONS.includes(p)) : [];
    if (!name) return res.status(400).json({ error: 'Role name required' });
    if (permissions.length === 0) return res.status(400).json({ error: 'Pick at least one function' });

    const r = await db.query(
      'INSERT INTO org_roles (org_id, name, permissions) VALUES ($1, $2, $3) RETURNING *',
      [req.user.org_id, name, JSON.stringify(permissions)]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'A role with that name already exists' });
    if (err.code === '42P01') return res.status(500).json({ error: 'Custom roles table missing — run the latest migration in Render PSQL' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// PATCH /api/roles/:id — rename or change functions
router.patch('/:id', async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const permissions = Array.isArray(req.body.permissions) ? req.body.permissions.filter(p => ALL_PERMISSIONS.includes(p)) : [];
    if (!name) return res.status(400).json({ error: 'Role name required' });
    const r = await db.query(
      'UPDATE org_roles SET name = $1, permissions = $2 WHERE id = $3 AND org_id = $4 RETURNING *',
      [name, JSON.stringify(permissions), req.params.id, req.user.org_id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Role not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// DELETE /api/roles/:id — blocked while members are assigned
router.delete('/:id', async (req, res) => {
  try {
    const assigned = await db.query('SELECT COUNT(*) as n FROM users WHERE role_id = $1', [req.params.id]);
    if (parseInt(assigned.rows[0].n) > 0) {
      return res.status(400).json({ error: `${assigned.rows[0].n} member(s) still have this role — reassign them first` });
    }
    await db.query('DELETE FROM org_roles WHERE id = $1 AND org_id = $2', [req.params.id, req.user.org_id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

module.exports = router;
