const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requireRole } = require('../middleware/auth');

// Compliance records are org-admin territory
router.use(authenticate, requireRole('admin', 'super_admin'));

// GET /api/compliance/nda — every signed NDA for this organization, newest first.
// Light list (no signature image / document blob); fetch one record for those.
router.get('/nda', async (req, res) => {
  try {
    const { search } = req.query;
    const params = [req.user.org_id];
    let where = 'n.org_id = $1';
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (n.visitor_name ILIKE $2 OR n.visitor_email ILIKE $2 OR n.signed_name ILIKE $2 OR v.badge_number ILIKE $2)`;
    }
    const r = await db.query(
      `SELECT n.id, n.visit_id, n.visitor_name, n.visitor_email, n.signed_name, n.signed_at,
              v.badge_number, v.purpose
       FROM nda_signatures n
       LEFT JOIN visits v ON v.id = n.visit_id
       WHERE ${where}
       ORDER BY n.signed_at DESC
       LIMIT 500`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(500).json({ error: 'NDA table missing — run the NDA migration in Render PSQL (migration-nda.txt)' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to load signed NDAs' });
  }
});

// GET /api/compliance/nda/:id — one full record, including the signature image
// and the exact document text that was signed
router.get('/nda/:id', async (req, res) => {
  try {
    const r = await db.query(
      'SELECT * FROM nda_signatures WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user.org_id]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Signed NDA not found' });
    }
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(500).json({ error: 'NDA table missing — run the NDA migration in Render PSQL (migration-nda.txt)' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to load signed NDA' });
  }
});

module.exports = router;
