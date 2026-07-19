const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requireRole } = require('../middleware/auth');

// Unambiguous pairing-code alphabet (no 0/O, 1/I/L)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const makePairCode = () => Array.from(crypto.randomBytes(6)).map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

// ─── PUBLIC: pair a kiosk device with its code ───
// POST /api/devices/pair  { code }
router.post('/pair', async (req, res) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Pairing code is required' });

    const result = await db.query(
      `UPDATE devices d SET paired_at = NOW(), last_seen_at = NOW()
       FROM organizations o
       WHERE d.pair_code = $1 AND d.is_active = true AND o.id = d.org_id AND o.status = 'active'
       RETURNING d.id, d.name, d.org_id, o.name AS org_name`,
      [code]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid pairing code' });
    }
    const d = result.rows[0];
    res.json({ device_id: d.id, device_name: d.name, org_id: d.org_id, org_name: d.org_name });
  } catch (err) {
    console.error('Pair error:', err);
    res.status(500).json({ error: 'Failed to pair device' });
  }
});

// ─── AUTHENTICATED: list devices with live online status ───
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, pair_code, paired_at, last_seen_at, created_at, is_active,
              (last_seen_at > NOW() - INTERVAL '3 minutes') AS is_online
       FROM devices WHERE org_id = $1 AND is_active = true
       ORDER BY created_at ASC`,
      [req.user.org_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Devices list error:', err);
    if (err.code === '42P01') {
      return res.status(500).json({ error: 'Devices table not found — run migration-devices.txt in Render PSQL first' });
    }
    res.status(500).json({ error: 'Failed to load devices' });
  }
});

// ─── ADMIN: register a new kiosk device ───
router.post('/', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Device name is required' });
    if (name.length > 120) return res.status(400).json({ error: 'Name too long' });

    let created = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      try {
        const result = await db.query(
          'INSERT INTO devices (org_id, name, pair_code) VALUES ($1, $2, $3) RETURNING *',
          [req.user.org_id, name, makePairCode()]
        );
        created = result.rows[0];
      } catch (e) {
        if (e.code !== '23505') throw e; // retry only on pair_code collision
      }
    }
    res.status(201).json(created);
  } catch (err) {
    console.error('Device create error:', err);
    if (err.code === '42P01') {
      return res.status(500).json({ error: 'Devices table not found — run migration-devices.txt in Render PSQL first' });
    }
    res.status(500).json({ error: 'Failed to add device' });
  }
});

// ─── ADMIN: rename a device ───
router.patch('/:id', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Device name is required' });
    const result = await db.query(
      'UPDATE devices SET name = $1 WHERE id = $2 AND org_id = $3 RETURNING *',
      [name, req.params.id, req.user.org_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Device not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Device rename error:', err);
    res.status(500).json({ error: 'Failed to rename device' });
  }
});

// ─── ADMIN: remove a device (kiosk will need a new code to re-pair) ───
router.delete('/:id', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const result = await db.query(
      'UPDATE devices SET is_active = false WHERE id = $1 AND org_id = $2 RETURNING id',
      [req.params.id, req.user.org_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Device not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Device delete error:', err);
    res.status(500).json({ error: 'Failed to remove device' });
  }
});

module.exports = router;
