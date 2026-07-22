const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requirePermission } = require('../middleware/auth');

// Turn Postgres "missing column/table" errors into a precise, actionable message
// that names the ACTUAL missing column instead of guessing (a past version blamed
// photo_data for every 42703 — including a missing updated_at — and sent everyone
// chasing the wrong migration).
function missingColumnError(err, res) {
  if (err.code === '42703' || err.code === '42P01') {
    const m = /column "([^"]+)" of relation "([^"]+)"/.exec(err.message || '');
    const detail = m ? `column "${m[1]}" on table "${m[2]}"` : (err.message || 'a required column');
    res.status(500).json({ error: `Database schema out of date — ${detail} is missing. Run the latest migration in Render PSQL.` });
    return true;
  }
  return false;
}

// PUBLIC ENDPOINTS (must come BEFORE authenticated routes with params)
router.get('/public/:orgId', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, first_name, last_name, email, phone, department, job_title FROM hosts WHERE org_id = $1 AND is_active = true ORDER BY last_name, first_name',
      [req.params.orgId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Public hosts error:', err);
    res.status(500).json({ error: 'Failed to fetch hosts' });
  }
});

// AUTHENTICATED ENDPOINTS
router.get('/', authenticate, requirePermission('hosts'), async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM hosts WHERE org_id = $1 AND is_active = true ORDER BY last_name, first_name',
      [req.user.org_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch hosts' });
  }
});

router.post('/', authenticate, requirePermission('hosts'), async (req, res) => {
  try {
    const { first_name, last_name, email, phone, department, job_title, photo_data, notes } = req.body;
    const result = await db.query(
      `INSERT INTO hosts (org_id, first_name, last_name, email, phone, department, job_title, photo_data, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.user.org_id, first_name, last_name, email || null, phone || null, department || null, job_title || null, photo_data || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (missingColumnError(err, res)) return;
    res.status(500).json({ error: 'Failed to create host' });
  }
});

router.put('/:id', authenticate, requirePermission('hosts'), async (req, res) => {
  try {
    const { first_name, last_name, email, phone, department, job_title, notify_email, notify_sms, notes } = req.body;

    // photo_data is only updated when the key is explicitly sent:
    //  - string  -> set/replace photo
    //  - null    -> remove photo
    //  - absent  -> keep existing photo
    const hasPhoto = Object.prototype.hasOwnProperty.call(req.body, 'photo_data');
    const photoSet = hasPhoto ? ', photo_data=$12' : '';
    const params = [first_name, last_name, email || null, phone || null, department || null, job_title || null,
      notify_email ?? true, notify_sms ?? false, notes || null, req.params.id, req.user.org_id];
    if (hasPhoto) params.push(req.body.photo_data || null);

    // NOTE: the hosts table has no updated_at column — don't reference one here
    const result = await db.query(
      `UPDATE hosts SET first_name=$1, last_name=$2, email=$3, phone=$4, department=$5, job_title=$6, notify_email=$7, notify_sms=$8, notes=$9${photoSet}
       WHERE id=$10 AND org_id=$11 RETURNING *`,
      params
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (missingColumnError(err, res)) return;
    res.status(500).json({ error: 'Failed to update host' });
  }
});

// POST /api/hosts/import — bulk-create hosts from parsed CSV rows.
// Body: { rows: [{ first_name, last_name, email, phone?, department?, job_title?, notes? }] }
// Duplicates (same email already a host in this org) are skipped, not failed.
router.post('/import', authenticate, requirePermission('hosts'), async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No rows to import' });
    }
    if (rows.length > 500) {
      return res.status(400).json({ error: 'Import is limited to 500 rows at a time' });
    }

    const created = [];
    const skipped = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 2; // +1 for header row, +1 for 1-based
      const first = (r.first_name || '').trim();
      const last = (r.last_name || '').trim();
      const email = (r.email || '').trim().toLowerCase();
      if (!first || !last || !email) {
        errors.push({ line, reason: 'missing first_name, last_name or email' });
        continue;
      }
      try {
        const dup = await db.query(
          'SELECT id FROM hosts WHERE org_id = $1 AND LOWER(email) = $2 AND is_active = true',
          [req.user.org_id, email]
        );
        if (dup.rows.length > 0) {
          skipped.push({ line, email, reason: 'already exists' });
          continue;
        }
        const ins = await db.query(
          `INSERT INTO hosts (org_id, first_name, last_name, email, phone, department, job_title, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, first_name, last_name, email`,
          [req.user.org_id, first, last, email,
            (r.phone || '').trim() || null, (r.department || '').trim() || null,
            (r.job_title || '').trim() || null, (r.notes || '').trim() || null]
        );
        created.push(ins.rows[0]);
      } catch (rowErr) {
        if (rowErr.code === '42703') {
          return res.status(500).json({ error: 'Database schema out of date — run the latest migration in Render PSQL (host notes column missing)' });
        }
        errors.push({ line, reason: rowErr.message });
      }
    }

    res.json({ created: created.length, skipped: skipped.length, errors: errors.length, detail: { created, skipped, errors } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to import hosts' });
  }
});

router.delete('/:id', authenticate, requirePermission('hosts'), async (req, res) => {
  try {
    await db.query('UPDATE hosts SET is_active = false WHERE id = $1 AND org_id = $2', 
      [req.params.id, req.user.org_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete host' });
  }
});

module.exports = router;
