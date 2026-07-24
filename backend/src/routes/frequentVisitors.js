const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../utils/db');
const { authenticate, requirePermission } = require('../middleware/auth');

// Frequent visitors — people who come often (couriers, cleaning crews, family
// members of staff) get a permanent ID like FV-7K2QM they can keep as a QR
// badge. Scanning it at the kiosk signs them in, scanning again signs them out.
// Requires migration-visitor-alerts.txt.

// No 0/O/1/I to keep codes readable when printed
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const makeCode = () => 'FV-' + Array.from(crypto.randomBytes(5)).map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

router.use(authenticate);

// GET /api/frequent-visitors — list this org's frequent visitors
router.get('/', requirePermission('prereg'), async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, code, first_name, last_name, email, phone, company, notes, is_active, created_at
       FROM frequent_visitors WHERE org_id = $1
       ORDER BY is_active DESC, last_name, first_name`,
      [req.user.org_id]
    );
    res.json(r.rows);
  } catch (e) {
    if (e.code === '42P01') return res.status(500).json({ error: 'Frequent visitors table is missing — run migration-visitor-alerts.txt in Render PSQL' });
    console.error(e);
    res.status(500).json({ error: 'Failed to load frequent visitors' });
  }
});

// POST /api/frequent-visitors — create one (server assigns the unique code)
router.post('/', requirePermission('prereg'), async (req, res) => {
  try {
    const { first_name, last_name, email, phone, company, notes } = req.body;
    if (!first_name?.trim() || !last_name?.trim()) {
      return res.status(400).json({ error: 'First and last name are required' });
    }
    let row = null;
    // Retry on the unlikely event of a code collision (UNIQUE(org_id, code))
    for (let i = 0; i < 5 && !row; i++) {
      try {
        const r = await db.query(
          `INSERT INTO frequent_visitors (org_id, code, first_name, last_name, email, phone, company, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [req.user.org_id, makeCode(), first_name.trim(), last_name.trim(),
           email?.trim().toLowerCase() || null, phone?.trim() || null,
           company?.trim() || null, notes?.trim() || null]
        );
        row = r.rows[0];
      } catch (e) {
        if (e.code === '23505' && i < 4) continue; // code collision — try another
        if (e.code === '42P01') return res.status(500).json({ error: 'Frequent visitors table is missing — run migration-visitor-alerts.txt in Render PSQL' });
        throw e;
      }
    }
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create frequent visitor' });
  }
});

// PATCH /api/frequent-visitors/:id — edit details or deactivate/reactivate
router.patch('/:id', requirePermission('prereg'), async (req, res) => {
  try {
    const { first_name, last_name, email, phone, company, notes, is_active } = req.body;
    const r = await db.query(
      `UPDATE frequent_visitors SET
         first_name = COALESCE($1, first_name),
         last_name = COALESCE($2, last_name),
         email = COALESCE($3, email),
         phone = COALESCE($4, phone),
         company = COALESCE($5, company),
         notes = COALESCE($6, notes),
         is_active = COALESCE($7, is_active)
       WHERE id = $8 AND org_id = $9 RETURNING *`,
      [first_name?.trim() ?? null, last_name?.trim() ?? null,
       email?.trim().toLowerCase() ?? null, phone?.trim() ?? null,
       company?.trim() ?? null, notes?.trim() ?? null,
       typeof is_active === 'boolean' ? is_active : null,
       req.params.id, req.user.org_id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Frequent visitor not found' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update frequent visitor' });
  }
});

// DELETE /api/frequent-visitors/:id
router.delete('/:id', requirePermission('prereg'), async (req, res) => {
  try {
    const r = await db.query('DELETE FROM frequent_visitors WHERE id = $1 AND org_id = $2 RETURNING id', [req.params.id, req.user.org_id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Frequent visitor not found' });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete frequent visitor' });
  }
});

module.exports = { router };
