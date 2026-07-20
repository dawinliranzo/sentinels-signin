const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate } = require('../middleware/auth');

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
router.get('/', authenticate, async (req, res) => {
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

router.post('/', authenticate, async (req, res) => {
  try {
    const { first_name, last_name, email, phone, department, job_title, photo_data } = req.body;
    const result = await db.query(
      `INSERT INTO hosts (org_id, first_name, last_name, email, phone, department, job_title, photo_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.org_id, first_name, last_name, email || null, phone || null, department || null, job_title || null, photo_data || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (missingColumnError(err, res)) return;
    res.status(500).json({ error: 'Failed to create host' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  try {
    const { first_name, last_name, email, phone, department, job_title, notify_email, notify_sms } = req.body;

    // photo_data is only updated when the key is explicitly sent:
    //  - string  -> set/replace photo
    //  - null    -> remove photo
    //  - absent  -> keep existing photo
    const hasPhoto = Object.prototype.hasOwnProperty.call(req.body, 'photo_data');
    const photoSet = hasPhoto ? ', photo_data=$11' : '';
    const params = [first_name, last_name, email || null, phone || null, department || null, job_title || null,
      notify_email ?? true, notify_sms ?? false, req.params.id, req.user.org_id];
    if (hasPhoto) params.push(req.body.photo_data || null);

    // NOTE: the hosts table has no updated_at column — don't reference one here
    const result = await db.query(
      `UPDATE hosts SET first_name=$1, last_name=$2, email=$3, phone=$4, department=$5, job_title=$6, notify_email=$7, notify_sms=$8${photoSet}
       WHERE id=$9 AND org_id=$10 RETURNING *`,
      params
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (missingColumnError(err, res)) return;
    res.status(500).json({ error: 'Failed to update host' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    await db.query('UPDATE hosts SET is_active = false WHERE id = $1 AND org_id = $2', 
      [req.params.id, req.user.org_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete host' });
  }
});

module.exports = router;
