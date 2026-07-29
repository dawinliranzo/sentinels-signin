const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requirePermission } = require('../middleware/auth');

// PUBLIC ENDPOINTS (must come BEFORE authenticated routes with params)
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

// AUTHENTICATED ENDPOINTS
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM visitor_types WHERE org_id = $1 AND is_active = true ORDER BY sort_order',
      [req.user.org_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch visitor types' });
  }
});

const HEX = /^#[0-9A-Fa-f]{6}$/;
const cleanType = (body) => {
  const out = {};
  if (body.name !== undefined) {
    const n = String(body.name || '').trim().slice(0, 60);
    if (!n) return { error: 'Type name is required' };
    out.name = n;
  }
  if (body.description !== undefined) out.description = String(body.description || '').trim().slice(0, 200);
  if (body.badge_color !== undefined) {
    const c = String(body.badge_color || '').trim();
    if (!HEX.test(c)) return { error: 'Badge color must be a hex color like #0D7377' };
    out.badge_color = c;
  }
  if (body.requires_nda !== undefined) out.requires_nda = body.requires_nda === true;
  return { fields: out };
};

// POST /api/visitor-types — create (admins; kiosk picks it up within a minute)
router.post('/', authenticate, requirePermission('settings'), async (req, res) => {
  try {
    const { error, fields } = cleanType(req.body || {});
    if (error) return res.status(400).json({ error });
    if (!fields.name) return res.status(400).json({ error: 'Type name is required' });
    const result = await db.query(
      `INSERT INTO visitor_types (org_id, name, description, badge_color, requires_nda, sort_order)
       VALUES ($1, $2, $3, $4, $5,
         (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM visitor_types WHERE org_id = $1))
       RETURNING *`,
      [req.user.org_id, fields.name, fields.description || '', fields.badge_color || '#0D7377', fields.requires_nda === true]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create visitor type error:', err);
    res.status(500).json({ error: 'Failed to create visitor type' });
  }
});

// PUT /api/visitor-types/:id — rename / recolor / toggle NDA without recreating
router.put('/:id', authenticate, requirePermission('settings'), async (req, res) => {
  try {
    const { error, fields } = cleanType(req.body || {});
    if (error) return res.status(400).json({ error });
    const keys = Object.keys(fields);
    if (keys.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
    const result = await db.query(
      `UPDATE visitor_types SET ${sets} WHERE id = $1 AND org_id = $2 AND is_active = true RETURNING *`,
      [req.params.id, req.user.org_id, ...keys.map(k => fields[k])]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Visitor type not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update visitor type error:', err);
    res.status(500).json({ error: 'Failed to update visitor type' });
  }
});

// DELETE /api/visitor-types/:id — soft delete: past visits keep their type label
router.delete('/:id', authenticate, requirePermission('settings'), async (req, res) => {
  try {
    const result = await db.query(
      'UPDATE visitor_types SET is_active = false WHERE id = $1 AND org_id = $2 AND is_active = true RETURNING id',
      [req.params.id, req.user.org_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Visitor type not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete visitor type' });
  }
});

module.exports = router;
