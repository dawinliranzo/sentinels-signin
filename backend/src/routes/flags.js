const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requirePermission } = require('../middleware/auth');

// Visitor flags = private staff notes about a visitor (side notes like
// "not welcome" or "be careful with this person"). NEVER exposed to the
// public kiosk screens — only flag severity reaches the check-in response.
//
// A flag identifies a visitor EITHER by email (matches the email typed at the
// kiosk) OR, when no email is on file, by exact first+last name pair — because
// kiosk visitors don't always give an email and must still be blockable.
//
// Requires migration-visitor-alerts.txt + migration-visitor-alerts-v2.txt.

// Look up active flags matching a visitor. Pass whatever the visitor gave —
// email, first name, last name (any may be empty). A flag matches when EITHER
// identity matches: its email equals the typed email, OR its stored name pair
// equals the typed name — so a blacklisted person can't slip through by
// leaving the email blank or typing a different one.
// Tolerates the table being missing (migration not run) → no flags.
async function getFlagsForVisitor(orgId, email, firstName, lastName) {
  try {
    const r = await db.query(
      `SELECT id, visitor_email, visitor_first_name, visitor_last_name, visitor_name, note, severity
       FROM visitor_flags
       WHERE org_id = $1 AND is_active = true AND (
         (visitor_email IS NOT NULL AND visitor_email <> ''
            AND LOWER(visitor_email) = LOWER($2))
         OR
         (visitor_first_name IS NOT NULL AND visitor_last_name IS NOT NULL
            AND LOWER(visitor_first_name) = LOWER($3)
            AND LOWER(visitor_last_name)  = LOWER($4))
       )`,
      [orgId, (email || '').trim(), (firstName || '').trim(), (lastName || '').trim()]
    );
    return r.rows;
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') {
      console.error('Visitor flags unavailable — run migration-visitor-alerts.txt and migration-visitor-alerts-v2.txt (', e.code, ')');
      return [];
    }
    throw e;
  }
}

router.use(authenticate);

// GET /api/flags — list this org's visitor flags (watchlist / blacklist)
router.get('/', requirePermission('visits'), async (req, res) => {
  try {
    const r = await db.query(
      `SELECT f.id, f.visitor_email, f.visitor_first_name, f.visitor_last_name, f.visitor_name,
              f.note, f.severity, f.is_active, f.created_at,
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
    if (e.code === '42P01' || e.code === '42703') return res.status(500).json({ error: 'Visitor flags need the migrations — run migration-visitor-alerts.txt and migration-visitor-alerts-v2.txt in Render PSQL' });
    console.error(e);
    res.status(500).json({ error: 'Failed to load visitor flags' });
  }
});

// POST /api/flags — add or update a flag. Identifies the visitor by email
// OR by first+last name when no email is known.
router.post('/', requirePermission('visits'), async (req, res) => {
  try {
    const { visitor_email, visitor_name, visitor_first_name, visitor_last_name, note, severity = 'warning' } = req.body;
    const email = (visitor_email || '').trim().toLowerCase();
    const firstName = (visitor_first_name || '').trim();
    const lastName = (visitor_last_name || '').trim();

    if (!email && (!firstName || !lastName)) {
      return res.status(400).json({ error: 'Provide the visitor\'s email, or their first and last name' });
    }
    if (email && !email.includes('@')) {
      return res.status(400).json({ error: 'That email doesn\'t look valid' });
    }
    if (!['info', 'warning', 'blacklist'].includes(severity)) {
      return res.status(400).json({ error: 'Severity must be info, warning or blacklist' });
    }

    const displayName = (visitor_name || '').trim() || [firstName, lastName].filter(Boolean).join(' ') || email;

    // Manual upsert (the unique indexes are partial, so ON CONFLICT can't target them).
    // An existing flag matches by EITHER identity so we don't stack duplicates
    // when the same person gets flagged once by email and once by name.
    const match = await db.query(
      `SELECT id, visitor_email, visitor_first_name, visitor_last_name FROM visitor_flags
       WHERE org_id = $1 AND (
         (visitor_email IS NOT NULL AND visitor_email <> '' AND LOWER(visitor_email) = LOWER($2))
         OR
         ($3 <> '' AND $4 <> '' AND visitor_first_name IS NOT NULL AND visitor_last_name IS NOT NULL
           AND LOWER(visitor_first_name) = LOWER($3) AND LOWER(visitor_last_name) = LOWER($4))
       )
       LIMIT 1`,
      [req.user.org_id, email || '', firstName, lastName]
    );

    let row;
    if (match.rows.length > 0) {
      // Update note/severity and ENRICH the identity: if we now know the email
      // (or the names) and the row doesn't have them yet, store both so the
      // flag matches by either at the kiosk.
      const ex = match.rows[0];
      const addEmail = email && !ex.visitor_email ? email : null;
      const addFirst = firstName && !ex.visitor_first_name ? firstName : null;
      const addLast = lastName && !ex.visitor_last_name ? lastName : null;
      try {
        const u = await db.query(
          `UPDATE visitor_flags SET visitor_name = $1, note = $2, severity = $3, is_active = true,
             visitor_email = COALESCE($4, visitor_email),
             visitor_first_name = COALESCE($5, visitor_first_name),
             visitor_last_name = COALESCE($6, visitor_last_name)
           WHERE id = $7 RETURNING *`,
          [displayName, (note || '').trim() || null, severity, addEmail, addFirst, addLast, ex.id]
        );
        row = u.rows[0];
      } catch (e) {
        if (e.code !== '23505') throw e; // another flag already owns that email — keep identities as-is
        const u = await db.query(
          `UPDATE visitor_flags SET visitor_name = $1, note = $2, severity = $3, is_active = true
           WHERE id = $4 RETURNING *`,
          [displayName, (note || '').trim() || null, severity, ex.id]
        );
        row = u.rows[0];
      }
    } else {
      const i = await db.query(
        `INSERT INTO visitor_flags (org_id, visitor_email, visitor_first_name, visitor_last_name, visitor_name, note, severity, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [req.user.org_id, email || null, firstName || null, lastName || null,
         displayName, (note || '').trim() || null, severity, req.user.id]
      );
      row = i.rows[0];
    }
    res.status(201).json(row);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return res.status(500).json({ error: 'Visitor flags need the migrations — run migration-visitor-alerts.txt and migration-visitor-alerts-v2.txt in Render PSQL' });
    if (e.code === '23505') return res.status(409).json({ error: 'That visitor is already flagged' });
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
