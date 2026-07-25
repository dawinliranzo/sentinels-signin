const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requirePermission, getUserAccess } = require('../middleware/auth');

// RFID cards — physical badge taps at the kiosk. A card UID maps to either a
// host (staff badge) or a frequent visitor. Enrollment happens in the admin
// portal with a USB keyboard-emulation reader (the reader "types" the UID).
// Requires migration-rfid.txt.

const MIGRATION_HINT = 'RFID table is missing — run migration-rfid.txt in Render PSQL';

// Resolve a tapped card to its person. Returns null when unknown/inactive.
// Tolerates the table being missing → null (kiosk shows "card not recognized").
async function getCardForTap(orgId, uid) {
  try {
    const r = await db.query(
      `SELECT c.id, c.card_type, c.label,
              h.id AS host_id, h.first_name AS host_first_name, h.last_name AS host_last_name,
              h.email AS host_email, h.phone AS host_phone, h.department AS host_department,
              h.photo_data AS host_photo, h.notes AS host_notes, h.is_active AS host_active,
              fv.id AS fv_id, fv.code AS fv_code, fv.first_name AS fv_first_name, fv.last_name AS fv_last_name,
              fv.email AS fv_email, fv.phone AS fv_phone, fv.company AS fv_company, fv.is_active AS fv_active
       FROM rfid_cards c
       LEFT JOIN hosts h ON h.id = c.host_id
       LEFT JOIN frequent_visitors fv ON fv.id = c.frequent_visitor_id
       WHERE c.org_id = $1 AND c.uid = $2 AND c.is_active = true`,
      [orgId, uid]
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    if (row.card_type === 'staff' && row.host_id) {
      return {
        kind: 'staff',
        person: {
          id: row.host_id, first_name: row.host_first_name, last_name: row.host_last_name,
          email: row.host_email, phone: row.host_phone, department: row.host_department,
          photo_data: row.host_photo, notes: row.host_notes, is_active: row.host_active,
        }
      };
    }
    if (row.card_type === 'frequent' && row.fv_id) {
      return {
        kind: 'frequent',
        person: {
          id: row.fv_id, code: row.fv_code, first_name: row.fv_first_name, last_name: row.fv_last_name,
          email: row.fv_email, phone: row.fv_phone, company: row.fv_company, is_active: row.fv_active,
        }
      };
    }
    return null;
  } catch (e) {
    if (e.code === '42P01') return null;
    throw e;
  }
}

// Does this user manage the given card type? (staff cards → hosts perm, frequent → prereg perm)
async function canManage(req, cardType) {
  if (req.user.switched) return true;
  if (req.user.role === 'admin' || req.user.role === 'super_admin') return true;
  const { permissions } = await getUserAccess(req.user);
  return permissions.includes(cardType === 'staff' ? 'hosts' : 'prereg');
}

router.use(authenticate);

// GET /api/rfid-cards — list this org's enrolled cards
router.get('/', requirePermission('visits'), async (req, res) => {
  try {
    const r = await db.query(
      `SELECT c.id, c.uid, c.card_type, c.label, c.is_active, c.created_at,
              c.host_id, c.frequent_visitor_id,
              h.first_name AS host_first_name, h.last_name AS host_last_name,
              fv.first_name AS fv_first_name, fv.last_name AS fv_last_name, fv.code AS fv_code
       FROM rfid_cards c
       LEFT JOIN hosts h ON h.id = c.host_id
       LEFT JOIN frequent_visitors fv ON fv.id = c.frequent_visitor_id
       WHERE c.org_id = $1
       ORDER BY c.created_at DESC`,
      [req.user.org_id]
    );
    res.json(r.rows);
  } catch (e) {
    if (e.code === '42P01') return res.status(500).json({ error: MIGRATION_HINT });
    console.error(e);
    res.status(500).json({ error: 'Failed to load RFID cards' });
  }
});

// POST /api/rfid-cards — enroll a card
router.post('/', async (req, res) => {
  try {
    const { uid, card_type, host_id, frequent_visitor_id, label } = req.body;
    const cleanUid = (uid || '').trim();
    if (!cleanUid || cleanUid.length < 4 || cleanUid.length > 64) {
      return res.status(400).json({ error: 'Card UID is required (4–64 characters)' });
    }
    if (!['staff', 'frequent'].includes(card_type)) {
      return res.status(400).json({ error: 'card_type must be staff or frequent' });
    }
    if (!(await canManage(req, card_type))) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Verify the person exists in this org
    if (card_type === 'staff') {
      const h = await db.query('SELECT id FROM hosts WHERE id = $1 AND org_id = $2', [host_id, req.user.org_id]);
      if (h.rows.length === 0) return res.status(400).json({ error: 'Host not found in your organization' });
    } else {
      const f = await db.query('SELECT id FROM frequent_visitors WHERE id = $1 AND org_id = $2', [frequent_visitor_id, req.user.org_id]);
      if (f.rows.length === 0) return res.status(400).json({ error: 'Frequent visitor not found in your organization' });
    }

    const r = await db.query(
      `INSERT INTO rfid_cards (org_id, uid, card_type, host_id, frequent_visitor_id, label)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.org_id, cleanUid, card_type,
       card_type === 'staff' ? host_id : null,
       card_type === 'frequent' ? frequent_visitor_id : null,
       (label || '').trim() || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '42P01') return res.status(500).json({ error: MIGRATION_HINT });
    if (e.code === '23505') return res.status(409).json({ error: 'That card is already enrolled for your organization' });
    console.error(e);
    res.status(500).json({ error: 'Failed to enroll card' });
  }
});

// PATCH /api/rfid-cards/:id — relabel or deactivate/reactivate
router.patch('/:id', async (req, res) => {
  try {
    const { label, is_active } = req.body;
    const existing = await db.query('SELECT card_type FROM rfid_cards WHERE id = $1 AND org_id = $2', [req.params.id, req.user.org_id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Card not found' });
    if (!(await canManage(req, existing.rows[0].card_type))) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const r = await db.query(
      `UPDATE rfid_cards SET
         label = COALESCE($1, label),
         is_active = COALESCE($2, is_active)
       WHERE id = $3 AND org_id = $4 RETURNING *`,
      [label ?? null, typeof is_active === 'boolean' ? is_active : null, req.params.id, req.user.org_id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update card' });
  }
});

// DELETE /api/rfid-cards/:id
router.delete('/:id', async (req, res) => {
  try {
    const existing = await db.query('SELECT card_type FROM rfid_cards WHERE id = $1 AND org_id = $2', [req.params.id, req.user.org_id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Card not found' });
    if (!(await canManage(req, existing.rows[0].card_type))) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    await db.query('DELETE FROM rfid_cards WHERE id = $1 AND org_id = $2', [req.params.id, req.user.org_id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

module.exports = { router, getCardForTap };
