// Per-organization backup snapshots — a sellable peace-of-mind feature.
// - Nightly job (03:00 UTC) snapshots every org whose plan includes 'backups'
// - Org admins (with the feature) can list + download their snapshots
// - Super admins can generate/download/restore snapshots for any org
const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requireRole, requirePermission, requireFeature } = require('../middleware/auth');
const { hasFeature } = require('../utils/plans');

// What goes into a snapshot. Order matters for restore (parents before children).
// password hashes & mfa secrets ARE included so a restore actually brings accounts back —
// snapshots are sensitive: only org admins (feature-gated) and super admins can download them.
const SNAPSHOT_TABLES = [
  { table: 'users', select: 'id, org_id, email, password_hash, first_name, last_name, role, role_id, is_active, mfa_enabled, mfa_required, must_change_password, created_at' },
  { table: 'hosts', select: '*' },
  { table: 'visits', select: '*' },
  { table: 'pre_registered_visitors', select: '*' },
  { table: 'devices', select: '*' },
  { table: 'visitor_types', select: '*' },
  { table: 'org_roles', select: '*' },
];

// Tables wiped before a restore (children of organizations, backups excluded).
// Discovered dynamically at restore time; this list is only a fallback.
const FALLBACK_WIPE = ['visits', 'pre_registered_visitors', 'devices', 'visitor_types', 'hosts', 'users', 'org_roles'];

const q = (client, text, params) => client ? client.query(text, params) : db.query(text, params);

// Generate a snapshot for one organization. Returns the inserted row (without data).
async function generateOrgBackup(orgId, kind = 'nightly', client = null) {
  const orgRes = await q(client,
    'SELECT id, name, slug, plan, status, settings, trial_ends_at, max_users, max_visits_per_month FROM organizations WHERE id = $1',
    [orgId]);
  if (orgRes.rows.length === 0) throw new Error('Organization not found');

  const data = { organization: orgRes.rows[0], tables: {} };
  const counts = {};
  for (const t of SNAPSHOT_TABLES) {
    try {
      const r = await q(client, `SELECT ${t.select} FROM ${t.table} WHERE org_id = $1`, [orgId]);
      data.tables[t.table] = r.rows;
      counts[t.table] = r.rows.length;
    } catch (e) {
      // Table/column missing in this database — skip it, snapshot stays valid
      data.tables[t.table] = [];
      counts[t.table] = 0;
    }
  }
  const json = JSON.stringify(data);
  const size = Buffer.byteLength(json, 'utf8');

  const ins = await q(client,
    'INSERT INTO org_backups (org_id, kind, data, counts, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id, org_id, kind, counts, size_bytes, created_at',
    [orgId, kind, json, JSON.stringify(counts), size]);
  return ins.rows[0];
}

// ---- Nightly job: snapshots for every org whose plan includes backups ----
let lastNightlyRun = 0;

async function runNightlyBackups() {
  try {
    let orgs;
    try {
      orgs = await db.query('SELECT id, plan, features FROM organizations');
    } catch (e) {
      if (e.code === '42703') orgs = await db.query('SELECT id, plan FROM organizations');
      else throw e;
    }
    for (const org of orgs.rows) {
      if (!hasFeature(org, 'backups')) continue;
      // One nightly snapshot per org per day
      const today = await db.query(
        "SELECT 1 FROM org_backups WHERE org_id = $1 AND kind = 'nightly' AND created_at::date = CURRENT_DATE LIMIT 1",
        [org.id]
      );
      if (today.rows.length > 0) continue;
      const meta = await generateOrgBackup(org.id, 'nightly');
      console.log(`Nightly backup: ${org.id} -> ${JSON.stringify(meta.counts)}`);
    }
    lastNightlyRun = Date.now();
  } catch (e) {
    if (e.code === '42P01') {
      // org_backups not migrated yet — stay quiet, try again next tick
      lastNightlyRun = Date.now();
      return;
    }
    console.error('Nightly backup run failed:', e.message);
  }
}

function startNightlyJob() {
  const HOURLY = 60 * 60 * 1000;
  setInterval(() => {
    const now = new Date();
    // Fire in the 03:00–03:59 UTC hour, at most once per 20h
    if (now.getUTCHours() === 3 && Date.now() - lastNightlyRun > 20 * HOURLY) {
      runNightlyBackups();
    }
  }, HOURLY);
  // Also run once 90s after boot if it's the 03:xx UTC hour (catches restarts)
  setTimeout(() => {
    if (new Date().getUTCHours() === 3 && Date.now() - lastNightlyRun > 20 * HOURLY) runNightlyBackups();
  }, 90 * 1000);
}

// =============== Org-facing endpoints (feature: backups) ===============

// List my org's snapshots

// Wipe an org's data and re-insert a snapshot, inside an open transaction on `client`.
// Callers must BEGIN before and COMMIT/ROLLBACK after.
async function restoreOrgFromSnapshot(client, orgId, data) {
  // Discover child tables dynamically (backups excluded)
  const tablesRes = await client.query(
    `SELECT table_name FROM information_schema.columns
     WHERE column_name = 'org_id' AND table_schema = 'public'
       AND table_name NOT IN ('organizations', 'org_backups')`
  );
  const wipeTables = tablesRes.rows.map(x => x.table_name).filter(n => /^[a-z_][a-z0-9_]*$/.test(n));

  for (const t of wipeTables) {
    await client.query(`DELETE FROM "${t}" WHERE org_id = $1`, [orgId]);
  }
  // Org profile fields (NOT plan/status/billing)
  if (data.organization.settings !== undefined) {
    await client.query('UPDATE organizations SET settings = $1, name = $2 WHERE id = $3',
      [JSON.stringify(data.organization.settings || {}), data.organization.name, orgId]);
  }
  // Re-insert snapshot rows (parents first per SNAPSHOT_TABLES order)
  for (const t of SNAPSHOT_TABLES) {
    const rows = data.tables[t.table] || [];
    for (const row of rows) {
      const cols = Object.keys(row).filter(k => /^[a-z_][a-z0-9_]*$/.test(k));
      if (cols.length === 0) continue;
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      try {
        await client.query(
          `INSERT INTO ${t.table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
          cols.map(k => row[k])
        );
      } catch (e) {
        // Column set drifted since the snapshot — drop the offending column and retry once
        if (e.code === '42703') {
          const missing = (e.message.match(/column "([^"]+)"/) || [])[1];
          const cols2 = cols.filter(x => x !== missing);
          await client.query(
            `INSERT INTO ${t.table} (${cols2.join(', ')}) VALUES (${cols2.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
            cols2.map(k => row[k])
          );
        } else throw e;
      }
    }
  }
}

// =============== Org endpoints ===============
router.get('/', authenticate, requirePermission('settings'), requireFeature('backups'), async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id, kind, counts, size_bytes, created_at FROM org_backups WHERE org_id = $1 ORDER BY created_at DESC LIMIT 30',
      [req.user.org_id]
    );
    res.json(r.rows);
  } catch (e) {
    if (e.code === '42P01') return res.status(500).json({ error: 'Backups table is missing — run migration-plans-backups.txt in Render PSQL' });
    console.error(e);
    res.status(500).json({ error: 'Failed to load backups' });
  }
});

// Download one of my org's snapshots as a JSON file
router.get('/:id/download', authenticate, requirePermission('settings'), requireFeature('backups'), async (req, res) => {
  try {
    const r = await db.query('SELECT org_id, data, created_at FROM org_backups WHERE id = $1 AND org_id = $2', [req.params.id, req.user.org_id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Backup not found' });
    const orgRes = await db.query('SELECT name FROM organizations WHERE id = $1', [r.rows[0].org_id]);
    const safeName = (orgRes.rows[0]?.name || 'org').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-backup-${r.rows[0].created_at.toISOString().slice(0, 10)}.json"`);
    res.send(JSON.stringify(r.rows[0].data, null, 2));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to download backup' });
  }
});

// Restore one of my org's snapshots — full wipe-and-replace of the org's data.
// This is the "everything has been lost" recovery path for customers.
router.post('/:id/restore', authenticate, requirePermission('settings'), requireFeature('backups'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    const r = await db.query('SELECT org_id, data FROM org_backups WHERE id = $1 AND org_id = $2', [req.params.id, req.user.org_id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Backup not found' });
    const { org_id, data } = r.rows[0];
    if (!data?.organization || !data?.tables) return res.status(400).json({ error: 'Snapshot is malformed' });

    await client.query('BEGIN');
    await restoreOrgFromSnapshot(client, org_id, data);
    await client.query('COMMIT');
    res.json({ success: true, restored: Object.fromEntries(Object.entries(data.tables).map(([k, v]) => [k, v.length])) });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: `Restore failed (nothing was changed): ${e.message}` });
  } finally {
    client.release();
  }
});

// =============== Super admin endpoints ===============

// List snapshots for any org
router.get('/super', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const { org_id } = req.query;
    const params = [];
    let where = '';
    if (org_id) { params.push(org_id); where = 'WHERE b.org_id = $1'; }
    const r = await db.query(
      `SELECT b.id, b.org_id, b.kind, b.counts, b.size_bytes, b.created_at, o.name as org_name
       FROM org_backups b JOIN organizations o ON o.id = b.org_id
       ${where} ORDER BY b.created_at DESC LIMIT 100`,
      params
    );
    res.json(r.rows);
  } catch (e) {
    if (e.code === '42P01') return res.status(500).json({ error: 'Backups table is missing — run migration-plans-backups.txt in Render PSQL' });
    console.error(e);
    res.status(500).json({ error: 'Failed to load backups' });
  }
});

// Generate a snapshot right now for any org
router.post('/super/generate', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const { org_id } = req.body;
    if (!org_id) return res.status(400).json({ error: 'org_id is required' });
    const meta = await generateOrgBackup(org_id, 'manual');
    res.json({ success: true, backup: meta });
  } catch (e) {
    if (e.code === '42P01') return res.status(500).json({ error: 'Backups table is missing — run migration-plans-backups.txt in Render PSQL' });
    console.error(e);
    res.status(500).json({ error: `Failed to generate backup: ${e.message}` });
  }
});

// Download any snapshot
router.get('/super/:id/download', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const r = await db.query(
      `SELECT b.org_id, b.data, b.created_at, o.name as org_name
       FROM org_backups b JOIN organizations o ON o.id = b.org_id WHERE b.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Backup not found' });
    const safeName = (r.rows[0].org_name || 'org').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-backup-${r.rows[0].created_at.toISOString().slice(0, 10)}.json"`);
    res.send(JSON.stringify(r.rows[0].data, null, 2));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to download backup' });
  }
});

// Restore an org from a snapshot: wipes current data (except backups) and
// re-inserts the snapshot, in one transaction. Plan/status/billing untouched.
router.post('/super/:id/restore', authenticate, requireRole('super_admin'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    const r = await db.query('SELECT org_id, data FROM org_backups WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Backup not found' });
    const { org_id, data } = r.rows[0];
    if (!data?.organization || !data?.tables) return res.status(400).json({ error: 'Snapshot is malformed' });

    const homeOrg = req.user.home_org_id || req.user.org_id;
    if (org_id === homeOrg) {
      return res.status(400).json({ error: 'You cannot restore your own organization — restore a customer org only' });
    }

    await client.query('BEGIN');
    await restoreOrgFromSnapshot(client, org_id, data);
    await client.query('COMMIT');
    res.json({ success: true, restored: data.tables ? Object.fromEntries(Object.entries(data.tables).map(([k, v]) => [k, v.length])) : {} });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: `Restore failed (nothing was changed): ${e.message}` });
  } finally {
    client.release();
  }
});

module.exports = { router, startNightlyJob, generateOrgBackup };
