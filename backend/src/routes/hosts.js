const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requirePermission, requireFeature } = require('../middleware/auth');

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
    // Inherited staff shared from the parent (or siblings) — visitors can pick them too.
    // Per-location opt-out via org_shared_staff.allowed = false. Tolerant before migration.
    let inherited = [];
    try {
      const r = await db.query(
        `SELECT h.id, h.first_name, h.last_name, h.email, h.phone, h.department, h.job_title
         FROM hosts h
         LEFT JOIN org_shared_staff s ON s.host_id = h.id AND s.org_id = $1
         WHERE h.shared_with_children = TRUE AND h.is_active = TRUE
           AND h.org_id <> $1
           AND COALESCE(s.allowed, TRUE) = TRUE
           AND (h.org_id = (SELECT parent_id FROM organizations WHERE id = $1)
                OR h.org_id IN (SELECT id FROM organizations WHERE parent_id = $1))
         ORDER BY h.last_name, h.first_name`, [req.params.orgId]);
      inherited = r.rows;
    } catch (e) { if (e.code !== '42703' && e.code !== '42P01') throw e; }
    const seen = new Set(result.rows.map((h) => h.id));
    res.json([...result.rows, ...inherited.filter((h) => !seen.has(h.id))]);
  } catch (err) {
    console.error('Public hosts error:', err);
    res.status(500).json({ error: 'Failed to fetch hosts' });
  }
});

// AUTHENTICATED ENDPOINTS
router.get('/', authenticate, requirePermission('hosts'), async (req, res) => {
  try {
    const { search, department, active } = req.query;
    const params = [req.orgId];
    let where = 'WHERE org_id = $1';
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }
    if (department) {
      params.push(department);
      where += ` AND department = $${params.length}`;
    }
    if (active !== undefined) where += ` AND is_active = ${active === 'true'}`;
    try {
      const result = await db.query(`SELECT * FROM hosts ${where} ORDER BY first_name, last_name`, params);
      res.json(result.rows);
    } catch (e) {
      if (e.code === '42703') {
        const result = await db.query(`SELECT id, org_id, first_name, last_name, email, phone, department, job_title,
            photo_data, notify_email, notify_sms, notes, is_active, created_at
          FROM hosts ${where} ORDER BY first_name, last_name`, params);
        return res.json(result.rows.map((r) => ({ ...r, shared_with_children: false })));
      }
      throw e;
    }
  } catch (err) {
    console.error('Get hosts error:', err);
    res.status(500).json({ error: 'Failed to fetch hosts' });
  }
});
router.put('/:id', authenticate, requirePermission('hosts'), async (req, res) => {
  try {
    const { first_name, last_name, email, phone, department, job_title, notify_email, notify_sms, notes } = req.body;
  if (Object.prototype.hasOwnProperty.call(req.body, 'shared_with_children')) {
    try {
      await db.query('UPDATE hosts SET shared_with_children = $1 WHERE id = $2 AND org_id = $3',
        [req.body.shared_with_children === true, req.params.id, req.orgId]);
    } catch (e) { if (e.code !== '42703' && e.code !== '42P01') throw e; }
  }

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
router.post('/import', authenticate, requirePermission('hosts'), requireFeature('bulk_import'), async (req, res) => {
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

// ── Organization family (parent / child locations) ──────────────────────────

// GET /api/hosts/family — family relationship + shared staff for this org
router.get('/family', authenticate, async (req, res) => {
  try {
    let org;
    try {
      const r = await db.query(
        `SELECT o.id, o.name, o.parent_id, p.name AS parent_name
         FROM organizations o LEFT JOIN organizations p ON p.id = o.parent_id
         WHERE o.id = $1`, [req.orgId]);
      org = r.rows[0];
    } catch (e) {
      if (e.code === '42703' || e.code === '42P01') {
        return res.json({ role: 'standalone', parent: null, children: [], sharedHosts: [], migrationPending: true });
      }
      throw e;
    }
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    let children = [];
    try {
      const c = await db.query(
        'SELECT id, name FROM organizations WHERE parent_id = $1 ORDER BY name', [req.orgId]);
      children = c.rows;
    } catch (e) { if (e.code !== '42703' && e.code !== '42P01') throw e; }

    // Hosts shared with this org: parent's hosts shared down to us (child orgs),
    // or sibling/child hosts shared up to us, each with per-location toggle.
    let sharedHosts = [];
    try {
      const s = await db.query(
        `SELECT h.id, h.first_name, h.last_name, h.email, h.department, h.job_title,
                h.org_id AS owner_org_id, o.name AS owner_org_name,
                COALESCE(s.allowed, TRUE) AS allowed
         FROM hosts h
         JOIN organizations o ON o.id = h.org_id
         LEFT JOIN org_shared_staff s ON s.host_id = h.id AND s.org_id = $1
         WHERE h.shared_with_children = TRUE AND h.is_active = TRUE
           AND h.org_id <> $1
           AND (h.org_id = (SELECT parent_id FROM organizations WHERE id = $1)
                OR h.org_id IN (SELECT id FROM organizations WHERE parent_id = $1))
         ORDER BY h.first_name, h.last_name`, [req.orgId]);
      sharedHosts = s.rows;
    } catch (e) { if (e.code !== '42703' && e.code !== '42P01') throw e; }

    res.json({
      role: org.parent_id ? 'child' : (children.length ? 'parent' : 'standalone'),
      parent: org.parent_id ? { id: org.parent_id, name: org.parent_name } : null,
      children,
      sharedHosts,
    });
  } catch (err) {
    console.error('Get family error:', err);
    res.status(500).json({ error: 'Failed to fetch family info' });
  }
});

// PUT /api/hosts/shared/:hostId — allow / disallow an inherited host at THIS location
router.put('/shared/:hostId', authenticate, requirePermission('hosts'), async (req, res) => {
  try {
    const { allowed } = req.body;
    if (allowed === undefined) return res.status(400).json({ error: 'allowed is required' });
    try {
      const r = await db.query(
        `INSERT INTO org_shared_staff (org_id, host_id, allowed) VALUES ($1, $2, $3)
         ON CONFLICT (org_id, host_id) DO UPDATE SET allowed = EXCLUDED.allowed
         RETURNING *`, [req.orgId, req.params.hostId, allowed === true]);
      res.json(r.rows[0]);
    } catch (e) {
      if (e.code === '42P01' || e.code === '42703') {
        return res.status(503).json({ error: 'Run the shared-staff migration first', code: 'MIGRATION_PENDING' });
      }
      throw e;
    }
  } catch (err) {
    console.error('Set shared host error:', err);
    res.status(500).json({ error: 'Failed to update shared staff' });
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
