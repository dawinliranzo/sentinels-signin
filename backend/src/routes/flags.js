const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requirePermission } = require('../middleware/auth');

// Visitor flags = private staff notes about a visitor (side notes like
// "not welcome" or "be careful with this person"). NEVER exposed to the
// public kiosk screens — only flag severity reaches the check-in response.
// Requires migration-visitor-alerts.txt.

// Look up active flags for a visitor email inside an org.
// Tolerates the table being missing (migration not run) → no flags.
async function getFlagsForVisitor(orgId, email) {
  if (!email) return [];
  try {
    const r = await db.query(
      `SELECT id, visitor_email, visitor_name, note, severity
       FROM visitor_flags
       WHERE org_id = $1 AND LOWER(visitor_email) = LOWER($2) AND is_active = true`,
      [orgId, email]
    );
    return r.rows;
  } catch (e) {
    if (e.code === '42P01') return []; // migration not run yet
    throw e;
  }
}

router.use(authenticate);

// GET /api/flags — list this org's visitor flags (watchlist / blacklist)
router.get('/', requirePermission('visits'), async (req, res) => {
  try {
    const r = await db.query(
      `SELECT f.id, f.visitor_email, f.visitor_name, f.note, f.severity, f.is_active, f.created_at,
              u.first_name AS created_by_first_name, u.last_name AS created_by_last_name
       FROM visitor_flags f
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.org_id = $1
       ORDER BY f.is_active DESC,
                CASE f.severity WHEN 'blacklist' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                f.created_at DESC`,
      [req.user.org_id]
    );
    res.json(r.rows);
  } catch (e) {
    if (e.code === '42P01') return res.status(500).json({ error: 'Visitor flags table is missing — run migration-visitor-alerts.txt in Render PSQL' });
    console.error(e);
    res.status(500).json({ error: 'Failed to load visitor flags' });
  }
});

// POST /api/flags — add or update a flag for a visitor email (upsert)
router.post('/', requirePermission('visits'), async (req, res) => {
  try {
    const { visitor_email, visitor_name, note, severity = 'warning' } = req.body;
    const email = (visitor_email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Visitor email is required' });
    }
    if (!['info', 'warning', 'blacklist'].includes(severity)) {
      return res.status(400).json({ error: 'Severity must be info, warning or blacklist' });
    }
    const r = await db.query(
      `INSERT INTO visitor_flags (org_id, visitor_email, visitor_name, note, severity, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (org_id, visitor_email)
       DO UPDATE SET visitor_name = EXCLUDED.visitor_name, note = EXCLUDED.note,
                     severity = EXCLUDED.severity, is_active = true
       RETURNING *`,
      [req.user.org_id, email, (visitor_name || '').trim() || null, (note || '').trim() || null, severity, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '42P01') return res.status(500).json({ error: 'Visitor flags table is missing — run migration-visitor-alerts.txt in Render PSQL' });
    console.error(e);
    res.status(500).json({ error: 'Failed to save visitor flag' });
  }
});

// PATCH /api/flags/:id — edit note/severity or toggle active
router.patch('/:id', requirePermission('visits'), async (req, res) => {
  try {
    const { visitor_name, note, severity, is_active } = req.body;
    if (severity !== undefined && !['info', 'warning', 'blacklist'].includes(severity)) {
      return res.status(400).json({ error: 'Severity must be info, warning or blacklist' });
    }
    const r = await db.query(
      `UPDATE visitor_flags SET
         visitor_name = COALESCE($1, visitor_name),
         note = COALESCE($2, note),
         severity = COALESCE($3, severity),
         is_active = COALESCE($4, is_active)
       WHERE id = $5 AND org_id = $6
       RETURNING *`,
      [visitor_name ?? null, note ?? null, severity ?? null,
       typeof is_active === 'boolean' ? is_active : null, req.params.id, req.user.org_id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Flag not found' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update flag' });
  }
});

// DELETE /api/flags/:id
router.delete('/:id', requirePermission('visits'), async (req, res) => {
  try {
    const r = await db.query('DELETE FROM visitor_flags WHERE id = $1 AND org_id = $2 RETURNING id', [req.params.id, req.user.org_id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Flag not found' });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete flag' });
  }
});

module.exports = { router, getFlagsForVisitor };
